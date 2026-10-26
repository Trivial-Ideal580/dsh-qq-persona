import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireInstanceLock } from '../src/instance-lock.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'qq-persona-lock-'));
  return { dir, file: join(dir, 'bot.lock') };
}

test('拿到锁会写 PID，释放后删除', () => {
  const { dir, file } = tempFile();
  try {
    const lock = acquireInstanceLock(file, silent);
    assert.equal(lock.ok, true);
    assert.match(readFileSync(file, 'utf8'), new RegExp(String(process.pid)));
    lock.release();
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('残留的旧 PID 不会挡住启动', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, '999999 2020-01-01T00:00:00.000Z\n', 'utf8');
    const lock = acquireInstanceLock(file, silent);
    assert.equal(lock.ok, true);
    lock.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('自己进程留下的锁可以重新获取', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, `${process.pid} ${new Date().toISOString()}\n`, 'utf8');
    const lock = acquireInstanceLock(file, silent);
    assert.equal(lock.ok, true);
    lock.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
