/**
 * 进程管理冒烟测试：用一个假的“机器人进程”验证 启动 / 日志 / 停止。
 * 不会碰真实 dsh，也不会连 QQ。
 *
 *   node scripts/bot-smoke.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotProcess } from '../studio/lib/bot.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = join(ROOT, '.tmp', 'bot-smoke');
const LOG = join(TMP, 'bot.log');
const FAKE = join(TMP, 'fake-bot.mjs');

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  FAKE,
  [
    "console.log('fake bot starting');",
    "console.log('机器人已上线 appId=fake');",
    'setInterval(() => console.log(`tick ${new Date().toISOString()}`), 250);',
  ].join('\n'),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bot = new BotProcess({
  dshCmd: undefined,
  profile: 'fake',
  profileDir: TMP,
  logFile: LOG,
  commandLine: `"${process.execPath}" "${FAKE}"`,
});

const started = bot.start();
assert.equal(started.ok, true, started.error);
assert.equal(bot.status().running, true);
console.log('✔ 启动进程');

await sleep(900);
let log = bot.tail(0);
assert.ok(log.lines.some((line) => line.includes('机器人已上线')), '日志应包含上线标记');
assert.equal(bot.detectPhase(), 'online');
console.log('✔ 日志 tail 与上线检测');

const beforeStop = log.lines.length;
await sleep(500);
log = bot.tail(beforeStop);
assert.ok(log.lines.length > 0, '应该有新日志');
console.log('✔ 增量读取日志');

await bot.stop();
assert.equal(bot.status().running, false, '停止后不应再运行');
console.log('✔ 停止进程');

const finalLog = bot.tail(0);
assert.ok(finalLog.lines.some((line) => line.includes('进程已退出')), '应记录退出');
console.log('✔ 退出状态记录');

bot.clearLog();
assert.equal(bot.tail(0).lines.length, 0);
console.log('✔ 清空日志');

// 崩溃自愈：进程异常退出后应自动重启一次，且不会无限重启
const FAKE_CRASH = join(TMP, 'fake-crash.mjs');
const CRASH_MARKER = join(TMP, 'crashed.once');
writeFileSync(
  FAKE_CRASH,
  [
    "import { existsSync, writeFileSync } from 'node:fs';",
    "console.log('crash bot start');",
    `const marker = ${JSON.stringify(CRASH_MARKER)};`,
    "if (!existsSync(marker)) {",
    "  writeFileSync(marker, '1');",
    '  setTimeout(() => process.exit(1), 600);',
    '} else {',
    "  console.log('crash bot stable');",
    '  setInterval(() => {}, 1000);',
    '}',
  ].join('\n'),
);

const crashBot = new BotProcess({
  dshCmd: undefined,
  profile: 'fake',
  profileDir: TMP,
  logFile: join(TMP, 'crash.log'),
  commandLine: `"${process.execPath}" "${FAKE_CRASH}"`,
});
crashBot.start();
await sleep(5200);
const crashLines = crashBot.tail(0).lines;
assert.ok(crashLines.some((line) => line.includes('自动重启')), '日志应记录自动重启');
assert.equal(crashBot.status().running, true, '重启后应恢复运行');
assert.ok(crashBot.tail(0).lines.some((line) => line.includes('crash bot stable')));
console.log('✔ 异常退出后自动重启');

await crashBot.stop();
await sleep(800);
assert.equal(crashBot.status().running, false, '手动停止后不应再自动重启');
console.log('✔ 手动停止不会触发重启');

// 失败场景：进程活着但鉴权失败，应该被识别成 error 并带出原因
const FAKE_ERR = join(TMP, 'fake-bot-error.mjs');
writeFileSync(
  FAKE_ERR,
  [
    "console.log('[im-qq-persona] 启动 QQ 网关 appId=1');",
    "console.log('[im-qq-persona] 网关启动失败：Failed to get access_token: {\"code\":100016,\"message\":\"invalid appid or secret\"}');",
    'setInterval(() => {}, 1000);',
  ].join('\n'),
);

const errBot = new BotProcess({
  dshCmd: undefined,
  profile: 'fake',
  profileDir: TMP,
  logFile: join(TMP, 'err.log'),
  commandLine: `"${process.execPath}" "${FAKE_ERR}"`,
});
assert.equal(errBot.start().ok, true);
await sleep(1200);
const described = errBot.describe();
assert.equal(described.running, true);
assert.equal(described.phase, 'error', '应识别为启动失败');
assert.match(described.lastError ?? '', /invalid appid|网关启动失败/);
console.log('✔ 失败原因能被识别并带回界面');
await errBot.stop();

rmSync(TMP, { recursive: true, force: true });
console.log('\n进程管理冒烟测试通过。');
