import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCleanupScript,
  cleanupProfileProcesses,
  matchesProfileProcess,
  parseKilledPids,
} from '../studio/lib/processes.mjs';

const CLI =
  '"C:\\Users\\x\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" --profile qqbot';

test('只匹配同 profile 的 dsh CLI', () => {
  assert.equal(matchesProfileProcess(CLI, 'qqbot'), true);
  assert.equal(matchesProfileProcess(CLI, 'web'), false);
  assert.equal(matchesProfileProcess(CLI, 'qqbot2'), false); // 不能被前缀骗到
  assert.equal(matchesProfileProcess('"C:\\DeepSeek Harness.exe"', 'qqbot'), false);
  assert.equal(matchesProfileProcess('', 'qqbot'), false);
});

test('解析 PowerShell 返回：数组 / 单数字 / 空', () => {
  assert.deepEqual(parseKilledPids('[123,456]'), [123, 456]);
  assert.deepEqual(parseKilledPids('123'), [123]);
  assert.deepEqual(parseKilledPids(''), []);
  assert.deepEqual(parseKilledPids('not json'), []);
});

test('清理脚本带上 profile 和要保留的 pid', () => {
  const script = buildCleanupScript('qqbot', 4321);
  assert.match(script, /--profile/);
  assert.match(script, /"qqbot"/);
  assert.match(script, /\$keep = 4321/);
  assert.match(script, /Stop-Process/);
});

test('cleanup 会把被结束的 pid 交给调用方', async () => {
  const logs = [];
  const result = await cleanupProfileProcesses({
    profile: 'qqbot',
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    runner: async () => '[111,222]',
  });
  assert.deepEqual(result.killed, [111, 222]);
  assert.ok(logs.some((line) => line.includes('111')));
});

test('清理失败不抛异常，只记日志', async () => {
  const logs = [];
  const result = await cleanupProfileProcesses({
    profile: 'qqbot',
    logger: { info: () => {}, warn: (m) => logs.push(m) },
    runner: async () => {
      throw new Error('powershell 不可用');
    },
  });
  assert.deepEqual(result.killed, []);
  assert.match(result.error, /powershell/);
  assert.ok(logs[0].includes('清理残留进程失败'));
});
