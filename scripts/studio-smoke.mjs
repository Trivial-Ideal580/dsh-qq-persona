/**
 * 工作台集成测试：起一个真实的 studio 服务（指向 workspace 内的假 profile），
 * 用 HTTP 把关键接口跑一遍。不会连接 QQ，也不会动真实 profile。
 *
 *   node scripts/studio-smoke.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = join(ROOT, '.tmp', 'studio-home');
const PROFILE = 'qqbot-smoke';
const PROFILE_DIR = join(HOME, 'profiles', PROFILE);
const PORT = 7799;
const BASE = `http://127.0.0.1:${PORT}`;

function prepareFixture() {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(PROFILE_DIR, { recursive: true });
  writeFileSync(
    join(PROFILE_DIR, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-profile-qqbot',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(PROFILE_DIR, 'config.json'),
    JSON.stringify({ credentials: { appId: '123456', appSecret: 'secret' }, bot: { name: '测试' } }, null, 2),
  );
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/state`);
      if (response.ok) return await response.json();
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('studio 服务没有在预期时间内启动');
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(`${path}: ${payload.error ?? response.status}`);
  return payload;
}

const results = [];
const check = (name) => {
  results.push(name);
  console.log(`✔ ${name}`);
};

prepareFixture();
const child = spawn(process.execPath, [join(ROOT, 'studio', 'server.mjs'), '--profile', PROFILE, '--dsh-home', HOME, '--no-cleanup', '--port', String(PORT), '--no-open'], {
  cwd: ROOT,
  stdio: 'ignore',
  windowsHide: true,
});

try {
  const initial = await waitForServer();
  assert.equal(initial.ok, true);
  assert.equal(initial.profile.profile, PROFILE);
  assert.equal(initial.profile.installed, true, '启动时应自动安装插件');
  assert.ok(initial.personas.length >= 2, '应加载内置人设');
  assert.equal(initial.credentials.appId, '123456');
  assert.equal(initial.credentials.hasSecret, true);
  assert.equal(initial.bot.running, false);
  check('启动 + 自动安装 + 状态接口');

  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  assert.match(html, /QQ 人设工作台/);
  const css = await fetch(`${BASE}/style.css`);
  assert.equal(css.status, 200);
  check('静态页面可访问');

  const detail = await api('/api/personas/linfi');
  assert.equal(detail.persona.name, '林绯');
  check('读取人设详情');

  const preview = await api('/api/preview', {
    method: 'POST',
    body: { persona: detail.persona, scene: { scope: 'group' } },
  });
  assert.match(preview.prompt, /林绯/);
  assert.match(preview.prompt, /不要用 Markdown/);
  check('prompt 预览');

  const created = await api('/api/personas', {
    method: 'POST',
    body: {
      persona: {
        id: 'studio-test',
        name: '测试人格',
        identity: '一个用来测试的普通人',
        personality: ['安静'],
        examples: [{ user: '在吗', assistant: ['在'] }],
        style: { tone: '平淡', emojiRate: 0, length: 'short' },
      },
    },
  });
  assert.equal(created.persona.id, 'studio-test');
  assert.equal(created.personas.some((item) => item.id === 'studio-test'), true);
  check('新建人设（写 YAML）');

  const yaml = await api('/api/personas/studio-test/raw');
  assert.match(yaml.raw, /id: studio-test/);
  assert.match(yaml.raw, /name: 测试人格/);
  check('读回 YAML');

  const updated = await api('/api/personas/studio-test', {
    method: 'PUT',
    body: { persona: { ...created.persona, name: '测试人格 2', reply: { maxBubbles: 3, maxCharsPerBubble: 30 } } },
  });
  assert.equal(updated.persona.name, '测试人格 2');
  assert.equal(updated.persona.reply.maxBubbles, 3);
  check('修改人设');

  const duplicated = await api('/api/personas/studio-test/duplicate', {
    method: 'POST',
    body: { id: 'studio-test-copy', name: '副本' },
  });
  assert.equal(duplicated.persona.id, 'studio-test-copy');
  check('另存为人设副本');

  await api('/api/personas/studio-test-copy', { method: 'DELETE' });
  await api('/api/personas/studio-test', { method: 'DELETE' });
  const afterDelete = await api('/api/personas');
  assert.equal(afterDelete.personas.some((item) => item.id.startsWith('studio-test')), false);
  check('删除人设');

  // 新建时 id 可以留空（用名字推导），中文 id 也允许
  const cn = await api('/api/personas', {
    method: 'POST',
    body: { persona: { id: '', name: '中文名字', identity: '', personality: [] } },
  });
  assert.equal(cn.persona.id, '中文名字');
  assert.equal(cn.persona.name, '中文名字');
  check('id 留空 + 中文 id 可以保存');

  let duplicate = false;
  try {
    await api('/api/personas', { method: 'POST', body: { persona: { name: '中文名字' } } });
  } catch (error) {
    duplicate = /已经有一个/.test(error.message);
  }
  assert.equal(duplicate, true, '重名应给出明确提示');
  check('重名有明确提示');

  let badId = false;
  try {
    await api('/api/personas', { method: 'POST', body: { persona: { id: '../evil', name: '坏 id' } } });
  } catch (error) {
    badId = /不能包含/.test(error.message);
  }
  assert.equal(badId, true, '非法 id 应被拒绝');
  check('非法 id 被拒绝');

  await api(`/api/personas/${encodeURIComponent('中文名字')}`, { method: 'DELETE' });

  let blocked = false;
  try {
    await api('/api/personas/linfi', { method: 'DELETE' });
  } catch (error) {
    blocked = /不能删除/.test(error.message);
  }
  assert.equal(blocked, true, '内置人设应拒绝删除');
  check('内置人设不可删除');

  const madeDefault = await api('/api/personas/xiaoman/default', { method: 'POST' });
  assert.equal(madeDefault.defaultPersonaId, 'xiaoman');
  check('设为默认人设');

  const saved = await api('/api/settings', {
    method: 'PUT',
    body: {
      personaId: 'linfi',
      trigger: { requireMention: false, keywords: ['小绯'], randomChance: 0.1, cooldownSec: 5, activeWindowMin: 10 },
      style: { maxBubbles: 2, maxCharsPerBubble: 36, emojiRate: 0.3 },
    },
  });
  assert.equal(saved.settings.trigger.requireMention, false);
  assert.deepEqual(saved.settings.trigger.keywords, ['小绯']);
  const settingsFile = join(HOME, 'qq-persona', 'settings.json');
  assert.equal(existsSync(settingsFile), true);
  const reread = await api('/api/settings');
  assert.equal(reread.settings.trigger.randomChance, 0.1);
  check('保存运行时设置');

  const visionSaved = await api('/api/settings', {
    method: 'PUT',
    body: { vision: { enabled: true, baseUrl: 'https://vision.test/v1', model: 'qwen-vl', apiKey: 'sk-secret' } },
  });
  assert.equal(visionSaved.settings.vision.hasKey, true);
  assert.equal(visionSaved.settings.vision.apiKey, '', '接口不应把 Key 回传');
  assert.equal(visionSaved.settings.vision.model, 'qwen-vl');
  const visionState = await api('/api/state');
  assert.equal(visionState.settings.vision.apiKey, '');
  assert.equal(visionState.settings.vision.hasKey, true);
  const settingsRaw = readFileSync(join(HOME, 'qq-persona', 'settings.json'), 'utf8');
  assert.match(settingsRaw, /sk-secret/, 'Key 应真正落盘');
  check('保存视觉模型配置（Key 不回传）');

  const imageSaved = await api('/api/settings', {
    method: 'PUT',
    body: { imagegen: { enabled: true, baseUrl: 'https://img.test/v1', model: 'flux', apiKey: 'sk-image' } },
  });
  assert.equal(imageSaved.settings.imagegen.hasKey, true);
  assert.equal(imageSaved.settings.imagegen.apiKey, '');
  const imageState = await api('/api/state');
  assert.equal(imageState.settings.imagegen.apiKey, '');
  assert.match(readFileSync(join(HOME, 'qq-persona', 'settings.json'), 'utf8'), /sk-image/);
  check('保存画图配置（Key 不回传）');

  const credentials = await api('/api/credentials', {
    method: 'PUT',
    body: { appId: '654321', appSecret: 'new-secret' },
  });
  assert.equal(credentials.credentials.appId, '654321');
  const profileConfig = JSON.parse(readFileSync(join(PROFILE_DIR, 'config.json'), 'utf8'));
  assert.equal(profileConfig.credentials.appSecret, 'new-secret');
  check('保存凭据到 profile config.json');

  const logs = await api('/api/logs?cursor=0');
  assert.equal(typeof logs.cursor, 'number');
  await api('/api/logs/clear', { method: 'POST' });
  const cleared = await api('/api/logs?cursor=0');
  assert.equal(cleared.lines.length, 0);
  check('日志读取与清空');

  const stateAfter = await api('/api/state');
  assert.equal(stateAfter.settings.trigger.requireMention, false);
  check('状态接口反映设置');

  const cleaned = await api('/api/bot/cleanup', { method: 'POST' });
  assert.equal(cleaned.ok, true);
  assert.ok(Array.isArray(cleaned.killed));
  check('清理残留进程接口');

  let keyRejected = false;
  try {
    await api('/api/settings', { method: 'PUT', body: { vision: { apiKey: 'https://api.openai.com/v1' } } });
  } catch (error) {
    keyRejected = /网址/.test(error.message);
  }
  assert.equal(keyRejected, true, '把网址填成 Key 应被拒绝');
  check('拒绝把网址填成 API Key');

  const visionProbe = await api('/api/vision/test', {
    method: 'POST',
    body: { apiKey: 'https://api.openai.com/v1' },
  });
  assert.equal(visionProbe.valid, false);
  assert.match(visionProbe.message, /网址/);
  check('视觉测试接口指出 Key 填错');

  console.log(`\n全部 ${results.length} 项工作台集成测试通过。`);
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 400));
  rmSync(HOME, { recursive: true, force: true });
}
