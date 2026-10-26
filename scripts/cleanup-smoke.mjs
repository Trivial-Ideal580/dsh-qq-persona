/**
 * 真实清理测试：造一个“孤儿” dsh CLI 进程，再用清理逻辑杀掉它。
 * 用的是独立 profile 名，不会碰真实机器人。
 *
 *   node scripts/cleanup-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupProfileProcesses, matchesProfileProcess } from '../studio/lib/processes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = join(ROOT, '.tmp', 'cleanup-smoke');
const PROFILE = 'qqbot-cleanup-smoke';
const FAKE_CLI = join(TMP, 'dsh-desktop-host', 'lib', 'cli.js');

rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, 'dsh-desktop-host', 'lib'), { recursive: true });
writeFileSync(
  FAKE_CLI,
  ["console.log('fake orphan cli started');", 'setInterval(() => {}, 1000);'].join('\n'),
);

const child = spawn(process.execPath, [FAKE_CLI, '--profile', PROFILE], {
  stdio: 'ignore',
  windowsHide: true,
});
await new Promise((resolve) => setTimeout(resolve, 800));
console.log(`✔ 造了一个假孤儿进程 pid=${child.pid}`);

const commandLine = `node ${FAKE_CLI} --profile ${PROFILE}`;
if (!matchesProfileProcess(commandLine, PROFILE)) {
  console.error('✖ 命令行匹配逻辑不认这个假进程');
  child.kill();
  process.exit(1);
}

const result = await cleanupProfileProcesses({ profile: PROFILE, logger: console });
console.log('清理结果：', JSON.stringify(result));
if (!result.killed.includes(child.pid) && !result.killed.includes(Number(child.pid))) {
  console.error('✖ 没有清理到目标进程');
  child.kill();
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, 600));
let alive = true;
try {
  process.kill(child.pid, 0);
} catch {
  alive = false;
}
if (alive) {
  console.error('✖ 进程还活着');
  child.kill();
  process.exit(1);
}
console.log('✔ 孤儿进程已被结束');

rmSync(TMP, { recursive: true, force: true });
console.log('\n清理功能测试通过。');
