#!/usr/bin/env node
/**
 * QQ 人设工作台 —— 本地可视化控制台。
 *
 *   node studio/server.mjs --profile qqbot --open
 *
 * 功能：启动/停止机器人、实时日志、可视化编辑人设、生成 prompt 预览、配置凭据。
 * 默认只监听 127.0.0.1，不对外暴露。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { installPlugin } from '../scripts/install-lib.mjs';
import { BotProcess } from './lib/bot.mjs';
import { PersonaService } from './lib/personas.mjs';
import { findDsh, makePaths, profileSummary, PROJECT_ROOT } from './lib/paths.mjs';
import { cleanupProfileProcesses } from './lib/processes.mjs';
import {
  readCredentials,
  readStudioSettings,
  saveCredentials,
  saveStudioSettings,
  testCredentials,
  testVision,
  validateApiKeys,
} from './lib/settings.mjs';

// ── 参数 ────────────────────────────────────────────────
function parseArgs(argv) {
  const options = { profile: 'qqbot', dshHome: undefined, port: 7788, open: true, install: true, cleanup: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile') options.profile = argv[++i];
    else if (arg === '--dsh-home') options.dshHome = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--open') options.open = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--no-install') options.install = false;
    else if (arg === '--no-cleanup') options.cleanup = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('用法：node studio/server.mjs [--profile qqbot] [--port 7788] [--dsh-home PATH] [--no-open] [--no-install]');
  process.exit(0);
}

const paths = makePaths({ profile: options.profile, dshHome: options.dshHome });
if (!paths.hasProfile) {
  console.error(`\n✖ 找不到 profile：${paths.profileDir}`);
  console.error(`  先运行一次 dsh --profile ${options.profile} 初始化，或用 --profile 指定别的 profile。\n`);
  process.exit(1);
}

// ── 启动前清理残留进程 ─────────────────────────────────
// 直接关掉 cmd 窗口时，dsh 子进程可能活下来继续占着网关，导致新进程被反复踢
const startupCleanup = options.cleanup
  ? await cleanupProfileProcesses({ profile: options.profile, logger: console })
  : { killed: [] };
if (startupCleanup.killed.length > 0) {
  console.log(`✔ 启动前清理了 ${startupCleanup.killed.length} 个残留机器人进程：${startupCleanup.killed.join(', ')}`);
}

// ── 安装插件（幂等）────────────────────────────────────
if (options.install) {
  const result = installPlugin({ profile: options.profile, dshHome: options.dshHome });
  if (result.ok) {
    if (result.changed) console.log(`✔ 已同步插件到 profile（bundles: ${result.bundles.join(' → ')}）`);
    if (result.connectorMissing) console.warn('⚠ profile 缺少 @tencent-connect/qqbot-nodejs，先运行 dsh plugin --profile qqbot add @tencent-connect/qqbot-nodejs');
  } else {
    console.warn(`⚠ 插件安装失败：${result.error}（界面仍可打开）`);
  }
}

// ── 服务对象 ────────────────────────────────────────────
const dshCmd = findDsh();
const botProcess = new BotProcess({
  dshCmd,
  profile: options.profile,
  profileDir: paths.profileDir,
  logFile: paths.logFile,
});

const personaService = new PersonaService({
  builtinDir: paths.builtinPersonasDir,
  userDir: paths.personasDir,
  logger: console,
});

const PUBLIC_DIR = join(PROJECT_ROOT, 'studio', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 把接口异常写进日志，方便排查“点了没反应”这类问题。 */
function logStudioError(req, pathname, error) {
  try {
    const file = join(dirname(paths.logFile), 'studio.log');
    mkdirSync(dirname(file), { recursive: true });
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    appendFileSync(file, `[${new Date().toISOString()}] ${req.method} ${pathname}\n${detail}\n\n`, 'utf8');
  } catch {
    // 日志写不了就算了
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('请求体太大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function publicSettings(settings) {
  const vision = { ...(settings.vision ?? {}) };
  const hasKey = Boolean(String(vision.apiKey ?? '').trim());
  vision.apiKey = '';
  vision.hasKey = hasKey;

  const imagegen = { ...(settings.imagegen ?? {}) };
  const hasImageKey = Boolean(String(imagegen.apiKey ?? '').trim());
  imagegen.apiKey = '';
  imagegen.hasKey = hasImageKey;

  return { ...settings, vision, imagegen };
}

function buildState() {
  const status = botProcess.describe();
  const personas = personaService.list();
  const settings = publicSettings(readStudioSettings(paths));
  const credentials = readCredentials(paths);
  const defaultPersonaId = settings.personaId || personas[0]?.id || '';
  return {
    ok: true,
    // 安装状态可能在启动后才变化，这里重新探测一次
    profile: { ...profileSummary(paths), installed: existsSync(join(paths.pluginDir, 'index.js')) },
    bot: status,
    personas,
    defaultPersonaId,
    settings,
    credentials,
    errors: personaService.store.errors,
  };
}

function serveStatic(req, res, pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, name));
  if (!file.startsWith(normalize(PUBLIC_DIR)) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  res.end(body);
}

// ── 路由 ────────────────────────────────────────────────
async function handleApi(req, res, url) {
  const method = req.method ?? 'GET';
  // pathname 是百分号编码的；中文 id 必须解码后才能匹配（decodeURIComponent 对坏编码会抛错）
  let parts;
  try {
    parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return json(res, 400, { ok: false, error: 'URL 编码不合法' });
  }
  const [, resource, id, action] = parts;

  if (resource === 'state' && method === 'GET') return json(res, 200, buildState());

  if (resource === 'logs') {
    if (method === 'GET') {
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const tail = botProcess.tail(Number.isFinite(cursor) ? cursor : 0);
      return json(res, 200, { ok: true, ...tail, size: botProcess.logSize() });
    }
    if (method === 'POST' && id === 'clear') {
      botProcess.clearLog();
      return json(res, 200, { ok: true });
    }
  }

  if (resource === 'bot' && method === 'POST') {
    if (id === 'cleanup') {
      const current = botProcess.status();
      const result = await cleanupProfileProcesses({
        profile: options.profile,
        keepPid: current.running ? current.pid : 0,
        logger: console,
      });
      return json(res, 200, { ok: true, ...result });
    }
    if (id === 'start') {
      // 先问一次开放平台：凭据不配套就没必要启动，直接把原因告诉用户
      const check = await testCredentials(paths, {});
      if (!check.ok && check.code !== undefined) {
        return json(res, 200, { ok: false, error: check.message });
      }
      if (!botProcess.status().running && options.cleanup) {
        const cleaned = await cleanupProfileProcesses({ profile: options.profile, logger: console });
        if (cleaned.killed.length > 0) {
          botProcess.appendStudioLine(`启动前清理了残留进程：${cleaned.killed.join(', ')}`);
        }
      }
      return json(res, 200, { ok: true, ...botProcess.start() });
    }
    if (id === 'stop') return json(res, 200, { ok: true, ...(await botProcess.stop()) });
    if (id === 'restart') {
      const check = await testCredentials(paths, {});
      if (!check.ok && check.code !== undefined) {
        return json(res, 200, { ok: false, error: check.message });
      }
      await botProcess.stop();
      if (options.cleanup) {
        await cleanupProfileProcesses({ profile: options.profile, logger: console });
      }
      return json(res, 200, { ok: true, ...botProcess.start() });
    }
  }

  if (resource === 'personas') {
    if (method === 'GET' && !id) return json(res, 200, { ok: true, personas: personaService.list(), errors: personaService.store.errors });
    if (method === 'GET' && id && !action) return json(res, 200, { ok: true, persona: personaService.get(id) });
    if (method === 'GET' && id && action === 'raw') return json(res, 200, { ok: true, raw: personaService.readRaw(id) });
    if (method === 'POST' && !id) {
      const body = await readJson(req);
      const saved = personaService.create(body.persona ?? body);
      return json(res, 200, { ok: true, ...saved, personas: personaService.list() });
    }
    if (method === 'PUT' && id) {
      const body = await readJson(req);
      const saved = personaService.save({ ...(body.persona ?? body), id });
      return json(res, 200, { ok: true, ...saved, personas: personaService.list() });
    }
    if (method === 'DELETE' && id) {
      const result = personaService.remove(id);
      return json(res, 200, { ok: true, ...result, personas: personaService.list() });
    }
    if (method === 'POST' && id && action === 'duplicate') {
      const body = await readJson(req);
      const saved = personaService.duplicate(id, body);
      return json(res, 200, { ok: true, ...saved, personas: personaService.list() });
    }
    if (method === 'POST' && id && action === 'default') {
      const settings = saveStudioSettings(paths, { personaId: id });
      return json(res, 200, { ok: true, defaultPersonaId: settings.personaId, settings });
    }
  }

  if (resource === 'preview' && method === 'POST') {
    const body = await readJson(req);
    return json(res, 200, { ok: true, ...personaService.preview(body.persona ?? body, body.scene) });
  }

  if (resource === 'settings') {
    if (method === 'GET') {
      return json(res, 200, { ok: true, settings: publicSettings(readStudioSettings(paths)) });
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      const invalid = validateApiKeys(body);
      if (invalid) return json(res, 400, { ok: false, error: invalid });
      const settings = saveStudioSettings(paths, body);
      let restarted = false;
      if (body.restart && botProcess.status().running) {
        await botProcess.restart();
        restarted = true;
      }
      return json(res, 200, { ok: true, settings: publicSettings(settings), restarted });
    }
  }

  if (resource === 'vision' && method === 'POST' && id === 'test') {
    const body = await readJson(req);
    const result = await testVision(paths, body);
    return json(res, 200, { ok: true, valid: result.ok, message: result.message, status: result.status });
  }

  if (resource === 'credentials') {
    if (method === 'GET') return json(res, 200, { ok: true, credentials: readCredentials(paths) });
    if (method === 'PUT') {
      const body = await readJson(req);
      const credentials = saveCredentials(paths, body);
      return json(res, 200, { ok: true, credentials });
    }
    if (method === 'POST' && id === 'test') {
      const body = await readJson(req);
      const result = await testCredentials(paths, body);
      return json(res, 200, { ok: true, valid: result.ok, message: result.message, code: result.code });
    }
  }

  if (resource === 'install' && method === 'POST') {
    const result = installPlugin({ profile: options.profile, dshHome: options.dshHome });
    return json(res, result.ok ? 200 : 500, result);
  }

  return json(res, 404, { ok: false, error: `没有这个接口：${method} ${url.pathname}` });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      logStudioError(req, url.pathname, error);
      json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

function openBrowser(target) {
  if (process.platform !== 'win32') return;
  try {
    spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', windowsHide: true, detached: true }).unref();
  } catch {
    // 打不开就让用户手动点链接
  }
}

async function listen(port, attempt = 0) {
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    return port;
  } catch (error) {
    if (error.code === 'EADDRINUSE' && attempt < 10) return listen(port + 1, attempt + 1);
    throw error;
  }
}

const port = await listen(Number.isFinite(options.port) ? options.port : 7788);
const url = `http://127.0.0.1:${port}`;

console.log('');
console.log('  ┌─────────────────────────────────────────────┐');
console.log('  │  QQ 人设工作台                              │');
console.log('  └─────────────────────────────────────────────┘');
console.log(`  地址：${url}`);
console.log(`  profile：${paths.profileDir}`);
console.log(`  人设：${personaService.store.size} 个（${paths.personasDir}）`);
console.log(`  dsh：${dshCmd ?? '未找到（设置 DSH_BIN 环境变量）'}`);
console.log('  关闭这个窗口会一起停掉机器人。\n');

if (options.open) openBrowser(url);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n正在停止机器人并退出工作台…');
  await botProcess.stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
