/**
 * 工作台的路径与运行环境探测。
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfileDir } from '../../scripts/install-lib.mjs';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function resolveHome(dshHome) {
  return resolve(dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'));
}

export function makePaths({ profile = 'qqbot', dshHome } = {}) {
  const home = resolveHome(dshHome);
  const profileDir = resolveProfileDir(profile, home);
  const pluginDir = join(profileDir, 'node_modules', 'dsh-qq-persona');
  const stateDir = join(home, 'qq-persona');
  return {
    home,
    profile,
    profileDir,
    pluginDir,
    builtinPersonasDir: join(PROJECT_ROOT, 'personas'),
    stateDir,
    personasDir: join(stateDir, 'personas'),
    settingsFile: join(stateDir, 'settings.json'),
    overridesFile: join(stateDir, 'overrides.json'),
    logFile: join(stateDir, 'logs', 'bot.log'),
    configFile: join(profileDir, 'config.json'),
    hasProfile: existsSync(join(profileDir, 'package.json')),
    installed: existsSync(join(pluginDir, 'index.js')),
  };
}

/** 找 dsh 可执行文件：环境变量 → 默认安装位置 → PATH。 */
export function findDsh() {
  const candidates = [];
  if (process.env.DSH_BIN) candidates.push(process.env.DSH_BIN);
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh'),
    );
  }
  if (process.env.ProgramFiles) {
    candidates.push(join(process.env.ProgramFiles, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  }
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue;
    candidates.push(join(dir, 'dsh.cmd'), join(dir, 'dsh.exe'), join(dir, 'dsh'));
  }
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

export function profileSummary(paths) {
  return {
    profile: paths.profile,
    home: paths.home,
    profileDir: paths.profileDir,
    pluginDir: paths.pluginDir,
    stateDir: paths.stateDir,
    hasProfile: paths.hasProfile,
    installed: paths.installed,
  };
}
