/**
 * 单实例锁：同一个 profile 只允许一个机器人进程连网关。
 *
 * 两个进程用同一个 AppID 连接时，QQ 会反复把连接踢掉（WebSocket 1006），
 * 看起来就像“机器人老是自动停止”。这里用 PID 文件挡住第二个实例。
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function acquireInstanceLock(file, logger) {
  try {
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8').trim();
      const pid = Number(raw.split(/\s+/)[0]);
      const ageMs = Date.now() - statSync(file).mtimeMs;
      if (Number.isFinite(pid) && pid > 0 && pid !== process.pid && alive(pid) && ageMs < 24 * 3600 * 1000) {
        return { ok: false, pid };
      }
    }
  } catch {
    // 读不到就当没有锁
  }

  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${process.pid} ${new Date().toISOString()}\n`, 'utf8');
  } catch (error) {
    logger?.warn?.(`写入实例锁失败：${error instanceof Error ? error.message : String(error)}`);
    return { ok: true, release() {} };
  }

  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      try {
        const raw = readFileSync(file, 'utf8').trim();
        if (Number(raw.split(/\s+/)[0]) === process.pid) unlinkSync(file);
      } catch {
        // 文件已经不在或没权限，忽略
      }
    },
  };
}
