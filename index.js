/**
 * dsh-qq-persona — 让 AI 以自定义人设接管 QQ 聊天。
 *
 * 一个纯 Cordis 插件：
 *   QQ 消息 → 中间件链 → 接话策略 → 该 peer 的 Agent（注入人设 prompt）
 *          → 模型回复 → 洗掉 Markdown / 拆成多条 / 模拟打字 → 发回 QQ
 *
 * 人设写在 personas/*.yaml 里，改完用 /persona reload 热重载。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ConfigSchema from './src/config.js';
import { buildCommands } from './src/commands.js';
import { startGateway } from './src/gateway.js';
import { PersonaOverrides, PersonaStore } from './src/persona.js';
import { MediaUnderstanding } from './src/media.js';
import { ImageGenerator } from './src/imagegen.js';
import { acquireInstanceLock } from './src/instance-lock.js';
import { PeerSessions, SessionSalts } from './src/session.js';
import { applySettings, readSettings } from './src/settings.js';
import { TriggerPolicy } from './src/trigger.js';
import { createLogger, errorText } from './src/util.js';

export const name = 'im-qq-persona';
export const inject = ['agents'];
export const Config = ConfigSchema;

const ROOT = dirname(fileURLToPath(import.meta.url));

/** 支持 config 里写 __FROM_ENV__ / 留空，从环境变量取。 */
function resolveEnv(value, envKey) {
  if (value && value !== '__FROM_ENV__' && !String(value).startsWith('process.env')) return String(value);
  return process.env[envKey] ?? '';
}

/**
 * 从 profile 目录的 config.json 读取凭据，兼容 `{ credentials: { appId, appSecret } }`
 * 这类已有配置，省得用户再抄一遍。
 */
function readProfileCredentials() {
  try {
    // ROOT 形如 <profile>/node_modules/dsh-qq-persona
    const marker = `${sep}node_modules${sep}`;
    const index = ROOT.lastIndexOf(marker);
    if (index <= 0) return null;
    const profileDir = ROOT.slice(0, index);
    const file = join(profileDir, 'config.json');
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const credentials = parsed?.credentials ?? parsed;
    if (credentials?.appId && credentials?.appSecret) {
      return { appId: String(credentials.appId), appSecret: String(credentials.appSecret), file };
    }
  } catch {
    // 读不到就算了
  }
  return null;
}

/** 没配置凭据时，尝试终端扫码（需要 qqbot-connector，装不上就打印手动指引）。 */
async function tryQrSetup(logger) {
  try {
    const mod = await import('@tencent-connect/qqbot-connector');
    logger.info('未配置 AppID/AppSecret，启动扫码绑定…');
    const credentials = await mod.qrConnect({ source: 'dsh-qq-persona' });
    const first = Array.isArray(credentials) ? credentials[0] : credentials;
    if (!first?.appId || !first?.appSecret) {
      logger.error('扫码没有返回有效凭据');
      return null;
    }
    logger.info(`绑定成功 AppID=${first.appId}`);
    logger.info('请把 AppSecret 写进 profile 的 cordis.patch.yml 或环境变量 QQBOT_SECRET，否则下次启动要重新扫码。');
    return { appId: String(first.appId), appSecret: String(first.appSecret) };
  } catch (error) {
    logger.error(`扫码绑定不可用（${errorText(error)}）`);
    logger.error('请手动配置：环境变量 QQBOT_APPID / QQBOT_SECRET，或 profile 的 cordis.patch.yml 里 im-qq-persona.config。');
    return null;
  }
}

export async function apply(ctx, config) {
  const logger = createLogger(ctx.logger);

  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');
  if (!appId || !appSecret) {
    const fromProfile = readProfileCredentials();
    if (fromProfile) {
      appId = fromProfile.appId;
      appSecret = fromProfile.appSecret;
      logger.info(`使用 ${fromProfile.file} 里的凭据 appId=${appId}`);
    }
  }
  if ((!appId || !appSecret) && config.autoQrSetup !== false) {
    const credentials = await tryQrSetup(logger);
    if (credentials) {
      appId = credentials.appId;
      appSecret = credentials.appSecret;
    }
  }
  if (!appId || !appSecret) {
    logger.error('缺少 QQ 机器人凭据，插件未启动。');
    return;
  }

  // 探针：确认能否读到宿主默认模型（headless profile 里没有 settings.yaml 时尤其重要）
  try {
    const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.();
    logger.info(
      `宿主默认模型：${selection?.provider ?? '(空)'}/${selection?.model ?? '(空)'}`,
    );
  } catch (error) {
    logger.warn(`读取宿主默认模型失败：${errorText(error)}`);
  }

  // ── 状态目录 ─────────────────────────────────────────
  const stateDir = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), 'qq-persona');

  // 同一个 profile 只允许一个实例连网关；否则 QQ 会反复踢连接
  const lock = acquireInstanceLock(join(stateDir, 'bot.lock'), logger);
  if (!lock.ok) {
    logger.error(
      `已经有另一个机器人进程在运行（pid ${lock.pid}），本进程不启动网关。请先在工作台点“停止”，或在任务管理器结束那个进程。`,
    );
    return;
  }
  process.once('exit', () => lock.release());  const overrides = new PersonaOverrides(join(stateDir, 'overrides.json'), logger);
  const salts = new SessionSalts(join(stateDir, 'sessions.json'), logger);

  // ── 人设：自带人设 → 自定义目录 → 工作台保存的人设（后者覆盖前者）──
  const builtinDir = join(ROOT, 'personas');
  const userDir = join(stateDir, 'personas');
  const dirs = [builtinDir];
  if (config.personasDir) dirs.push(resolve(config.personasDir));
  dirs.push(userDir);
  const personas = new PersonaStore({ dirs, logger }).load();
  logger.info(
    `人设目录 ${dirs.join(' → ')}；已加载 ${personas.size} 个：${personas
      .list()
      .map((persona) => `${persona.id}(${persona.name})`)
      .join(', ')}`,
  );
  if (personas.errors.length > 0) {
    logger.warn(`${personas.errors.length} 个人设文件解析失败，已跳过：\n${personas.errors.join('\n')}`);
  }

  // ── 工作台设置覆盖 ───────────────────────────────────
  const settings = readSettings(join(stateDir, 'settings.json'));
  const effective = applySettings(config, settings);
  if (Object.keys(settings).length > 0) {
    logger.info(`已应用工作台设置：${JSON.stringify(settings)}`);
  }

  // ── 会话 / 策略 / 指令 ───────────────────────────────
  const sessions = new PeerSessions({ ctx, config: effective, personas, overrides, logger, appId, salts });
  const policy = new TriggerPolicy(effective, logger);
  const media = new MediaUnderstanding({ config: effective, logger });
  if (effective.vision?.enabled !== false && !media.apiKey()) {
    logger.info('图片识别：未配置视觉模型 apiKey，图片会以文字占位符交给模型');
  } else if (effective.vision?.enabled !== false) {
    logger.info(`图片识别：${effective.vision.baseUrl} / ${effective.vision.model}`);
  }
  const imagegen = new ImageGenerator({ config: effective, logger });
  if (effective.imagegen?.enabled === false) {
    logger.info('画图：已关闭');
  } else if (!imagegen.apiKey()) {
    logger.info('画图：未配置 imagegen.apiKey / IMAGE_API_KEY，[[IMAGE: ...]] 会被忽略');
  } else {
    logger.info(`画图：${imagegen.baseUrl()} / ${effective.imagegen.model}`);
  }
  const commands = effective.commands.enabled
    ? buildCommands({ config: effective, personas, sessions, overrides, imagegen, logger })
    : [];

  await startGateway({
    ctx,
    config: effective,
    appId,
    appSecret,
    personas,
    sessions,
    policy,
    media,
    imagegen,
    commands,
    logger,
  });

  logger.info('插件已挂载。指令：/persona、/reset、/status');

  ctx.effect(() => () => lock.release(), 'im-qq-persona.lock');
}
