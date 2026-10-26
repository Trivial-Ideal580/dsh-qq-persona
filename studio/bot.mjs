/**
 * 机器人进程管理：启动 / 停止 / 重启 dsh profile，并把日志写进文件供界面轮询。
 *
 * 刻意不用管道：输出直接重定向到日志文件（`>> log 2>&1`），
 * 这样在受限环境里也不会因为管道权限失败，界面也只需要 tail 文件。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';

const ONLINE_MARKERS = ['机器人已上线', 'Bot ready', 'bot ready'];
const ERROR_MARKERS = [
  '网关启动失败',
  '缺少 QQ 机器人凭据',
  'invalid appid',
  'invalid appsecret',
  '100016',
  '401 Unauthorized',
  '403 Forbidden',
  'cannot resolve profile bundle',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ERR_MODULE_NOT_FOUND',
];
const STALL_MS = 30_000;

export class BotProcess {
  constructor({ dshCmd, profile, profileDir, logFile, commandLine }) {
    this.dshCmd = dshCmd;
    this.profile = profile;
    this.profileDir = profileDir;
    this.logFile = logFile;
    this.commandLine = commandLine ?? process.env.QQ_PERSONA_BOT_CMD;
    this.child = undefined;
    this.startedAt = undefined;
    this.lastExit = undefined;
    this.lastError = undefined;
    this.phase = 'stopped';
    this.autoRestart = true;
    this.autoRestarts = 0;
    this.stopping = false;
    this.restartTimer = undefined;
  }

  /** 给接口用的一致快照：状态 + phase + 最近错误。 */
  describe() {
    const snapshot = this.status();
    if (snapshot.running) this.detectPhase();
    snapshot.phase = this.phase;
    snapshot.lastError = this.lastError;
    snapshot.lastErrorLine = this.lastErrorLine;
    return snapshot;
  }

  ensureLogDir() {
    mkdirSync(dirname(this.logFile), { recursive: true });
  }

  status() {
    const running = Boolean(this.child) && this.child.exitCode === null && this.child.signalCode === null;
    if (!running) this.phase = this.restartTimer ? 'restarting' : 'stopped';
    return {
      running,
      phase: this.phase,
      pid: running ? this.child.pid : undefined,
      startedAt: running ? this.startedAt : undefined,
      lastExit: this.lastExit,
      lastError: this.lastError,
      uptimeSec: running && this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      dshCmd: this.dshCmd,
      logFile: this.logFile,
    };
  }

  appendStudioLine(text) {
    try {
      this.ensureLogDir();
      appendFileSync(this.logFile, `[工作台 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${text}\n`, 'utf8');
    } catch {
      // 日志写不了就算了
    }
  }

  start() {
    if (this.status().running) return { ok: false, error: '机器人已经在运行了' };
    const base = this.commandLine ?? (this.dshCmd ? `"${this.dshCmd}" --profile ${this.profile}` : undefined);
    if (!base) return { ok: false, error: '找不到 dsh，可设置环境变量 DSH_BIN 指向 dsh.cmd' };
    if (!existsSync(this.profileDir)) return { ok: false, error: `profile 不存在：${this.profileDir}` };

    this.stopping = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.phase = 'starting';
    this.lastError = undefined;
    this.lastErrorLine = undefined;
    this.ensureLogDir();
    this.appendStudioLine(`启动 ${base}`);

    const command = `${base} >> "${this.logFile}" 2>&1`;
    try {
      this.child = spawn(command, {
        shell: true,
        cwd: this.profileDir,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
    } catch (error) {
      this.lastError = error.message;
      this.phase = 'error';
      return { ok: false, error: error.message };
    }

    this.startedAt = Date.now();
    this.lastError = undefined;
    this.phase = 'starting';

    this.child.on('error', (error) => {
      this.lastError = error.message;
      this.phase = 'error';
      this.appendStudioLine(`进程启动失败：${error.message}`);
    });

    this.child.on('exit', (code, signal) => {
      const uptime = this.startedAt ? Date.now() - this.startedAt : 0;
      this.lastExit = { code, signal, at: Date.now() };
      this.phase = 'stopped';
      this.appendStudioLine(`进程已退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）`);
      this.child = undefined;
      this.startedAt = undefined;

      if (this.stopping) return;
      if (uptime > 120_000) this.autoRestarts = 0;
      if (this.autoRestart && this.autoRestarts < 3) {
        this.autoRestarts += 1;
        const delayMs = 3000 * this.autoRestarts;
        this.appendStudioLine(
          `异常退出，${Math.round(delayMs / 1000)} 秒后自动重启（第 ${this.autoRestarts}/3 次）`,
        );
        this.phase = 'restarting';
        this.restartTimer = setTimeout(() => {
          if (!this.stopping) this.start();
        }, delayMs);
      }
    });

    return { ok: true, pid: this.child.pid };
  }

  async stop() {
    const status = this.status();
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    if (!status.running) return { ok: true, already: true };
    const pid = this.child.pid;
    this.appendStudioLine('停止机器人…');

    await killTree(pid);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!this.child || this.child.exitCode !== null) break;
      await sleep(120);
    }
    if (this.child && this.child.exitCode === null) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // 忽略
      }
    }
    return { ok: true };
  }

  async restart() {
    await this.stop();
    await sleep(600);
    return this.start();
  }

  /** 读日志。cursor = 已经读过的行数。 */
  tail(cursor = 0) {
    let content = '';
    try {
      if (existsSync(this.logFile)) content = readFileSync(this.logFile, 'utf8');
    } catch {
      content = '';
    }
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    let from = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
    if (from > lines.length) from = 0;
    return { cursor: lines.length, lines: lines.slice(from) };
  }

  /** 根据日志判断上线 / 失败 / 卡住。 */
  detectPhase() {
    if (!this.status().running) return this.phase;
    const total = this.tail(0).cursor;
    const lines = this.tail(Math.max(0, total - 120)).lines;
    const recent = lines.join('\n');

    if (ONLINE_MARKERS.some((marker) => recent.includes(marker))) {
      this.phase = 'online';
      return this.phase;
    }

    const errorLine = [...lines].reverse().find((line) => ERROR_MARKERS.some((marker) => line.includes(marker)));
    if (errorLine) {
      this.lastErrorLine = errorLine.trim().slice(0, 300);
      this.lastError = this.lastErrorLine;
      this.phase = 'error';
      return this.phase;
    }

    if (this.phase === 'starting' && Date.now() - (this.startedAt ?? 0) > STALL_MS) {
      this.phase = 'stalled';
    }
    return this.phase;
  }

  clearLog() {
    try {
      if (existsSync(this.logFile)) truncateSync(this.logFile, 0);
    } catch {
      // 忽略
    }
    return { ok: true };
  }

  /** 只读探测：日志文件大小，供界面显示。 */
  logSize() {
    try {
      return statSync(this.logFile).size;
    } catch {
      return 0;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killTree(pid) {
  return new Promise((resolve) => {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}
