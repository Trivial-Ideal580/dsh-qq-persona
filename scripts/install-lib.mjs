/**
 * 安装/卸载逻辑（工作台和 CLI 共用）。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_NAME = 'dsh-qq-persona';
export const OFFICIAL_BOT = '@tencent-connect/dsh-qqbot';
export const COPY_ENTRIES = ['index.js', 'src', 'personas', 'cordis.patch.yml', 'package.json', 'README.md'];

export function resolveDshHome(explicit) {
  return resolve(explicit || process.env.DSH_HOME || join(homedir(), '.dsh'));
}

export function resolveProfileDir(profile, dshHome) {
  return join(resolveDshHome(dshHome), 'profiles', profile);
}

const silent = { info() {}, warn() {}, error() {} };

/** 把插件装进 profile。返回安装结果，不抛异常（失败返回 {ok:false, error}）。 */
export function installPlugin({ profile = 'qqbot', dshHome, keepOfficial = false, logger = console } = {}) {
  const profileDir = resolveProfileDir(profile, dshHome);
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, error: `找不到 profile：${profileDir}。先运行一次 dsh --profile ${profile} 初始化。` };
  }

  const targetDir = join(profileDir, 'node_modules', PACKAGE_NAME);
  const manifestRaw = readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (error) {
    return { ok: false, error: `profile package.json 解析失败：${error.message}` };
  }

  mkdirSync(targetDir, { recursive: true });
  for (const entry of COPY_ENTRIES) {
    const source = join(ROOT, entry);
    if (!existsSync(source)) continue;
    cpSync(source, join(targetDir, entry), {
      recursive: true,
      filter: (path) => !path.includes(`${sep}node_modules${sep}`) && !path.includes(`${sep}.tmp${sep}`),
    });
  }

  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : [];
  const next = bundles.filter((name) => name !== PACKAGE_NAME);
  if (!keepOfficial) {
    const index = next.indexOf(OFFICIAL_BOT);
    if (index >= 0) next.splice(index, 1);
  }
  if (!next.includes('@deepseek-ai/dsh-base')) next.unshift('@deepseek-ai/dsh-base');
  next.push(PACKAGE_NAME);
  manifest.dsh.profile.bundles = next;

  const nextRaw = `${JSON.stringify(manifest, null, 2)}\n`;
  const changed = nextRaw !== manifestRaw;
  let backup;
  if (changed) {
    backup = `${manifestPath}.bak-${Date.now()}`;
    writeFileSync(backup, manifestRaw, 'utf8');
    writeFileSync(manifestPath, nextRaw, 'utf8');
  }

  const connector = join(profileDir, 'node_modules', '@tencent-connect', 'qqbot-nodejs');
  return {
    ok: true,
    profileDir,
    targetDir,
    bundles: next,
    changed,
    backup,
    connectorMissing: !existsSync(connector),
    logger: logger ?? silent,
  };
}

export function uninstallPlugin({ profile = 'qqbot', dshHome } = {}) {
  const profileDir = resolveProfileDir(profile, dshHome);
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) return { ok: false, error: `找不到 profile：${profileDir}` };

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles = bundles.filter((name) => name !== PACKAGE_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const targetDir = join(profileDir, 'node_modules', PACKAGE_NAME);
  if (targetDir.includes(`${sep}node_modules${sep}${PACKAGE_NAME}`)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  return { ok: true, profileDir };
}
