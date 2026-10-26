#!/usr/bin/env node
/**
 * 开发用：把 dsh 安装里的依赖「解引用」复制成本项目的 node_modules，
 * 这样在源码目录里就能直接 import 插件、跑冒烟测试，而不需要先装进 profile。
 *
 *   node scripts/dev-link.mjs
 *
 * 只在开发时用；发布/安装走 scripts/install.mjs。
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE_NAME = process.env.QQ_PERSONA_PROFILE || 'qqbot';
const ANCHORS = [
  join(HOME, 'profiles', 'package.json'),
  join(HOME, 'profiles', PROFILE_NAME, 'package.json'),
];

function packageDir(name) {
  if (existsSync(join(ROOT, 'node_modules', ...name.split('/'), 'package.json'))) {
    return join(ROOT, 'node_modules', ...name.split('/'));
  }
  for (const anchor of ANCHORS) {
    const req = createRequire(anchor);
    for (const searchPath of req.resolve.paths(name) ?? []) {
      const candidate = join(searchPath, ...name.split('/'));
      if (existsSync(join(candidate, 'package.json'))) return candidate;
    }
  }
  return undefined;
}

function realDir(name) {
  const dir = packageDir(name);
  if (!dir) return undefined;
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

const queue = ['@tencent-connect/qqbot-nodejs', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm', '@deepseek-ai/schemastery'];
const seen = new Set();
const copied = [];

while (queue.length > 0) {
  const name = queue.shift();
  if (!name || seen.has(name)) continue;
  seen.add(name);
  const dir = realDir(name);
  if (!dir) {
    console.warn(`⚠ 找不到 ${name}，跳过`);
    continue;
  }
  const target = join(ROOT, 'node_modules', ...name.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(dir, target, { recursive: true, dereference: true });
  copied.push(name);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  for (const dep of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]) {
    const meta = manifest.peerDependenciesMeta?.[dep];
    if (meta?.optional) continue;
    if (!seen.has(dep)) queue.push(dep);
  }
}

console.log(`✔ 已复制 ${copied.length} 个包到 ${join(ROOT, 'node_modules')}`);
console.log(copied.sort().join('\n'));
