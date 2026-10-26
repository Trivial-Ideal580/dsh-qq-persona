import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { looksLikeUrl, testVision, validateApiKeys } from '../studio/lib/settings.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qq-persona-vision-'));
  const paths = {
    settingsFile: join(dir, 'settings.json'),
    configFile: join(dir, 'config.json'),
  };
  return { dir, paths };
}

function response({ status = 200, body = {}, text = undefined }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text ?? JSON.stringify(body),
  };
}

test('URL 被误填进 Key 会被识别', () => {
  assert.equal(looksLikeUrl('https://api.openai.com/v1'), true);
  assert.equal(looksLikeUrl('sk-abc123'), false);
});

test('保存设置时拦住“Key 是网址”', () => {
  const message = validateApiKeys({ vision: { apiKey: 'https://api.openai.com/v1' } });
  assert.match(message, /网址/);
  assert.equal(validateApiKeys({ vision: { apiKey: 'sk-real' } }), undefined);
});

test('测试视觉模型：连通成功', async () => {
  const { dir, paths } = fixture();
  try {
    const result = await testVision(
      paths,
      { baseUrl: 'https://v.test/v1', model: 'm', apiKey: 'sk-good' },
      { fetchImpl: async () => response({ body: { choices: [{ message: { content: 'OK' } }] } }) },
    );
    assert.equal(result.ok, true);
    assert.match(result.message, /连通正常/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('测试视觉模型：401 会带出服务端原因', async () => {
  const { dir, paths } = fixture();
  try {
    const result = await testVision(
      paths,
      { baseUrl: 'https://v.test/v1', apiKey: 'sk-bad' },
      { fetchImpl: async () => response({ status: 401, text: 'invalid api key' }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.message, /401/);
    assert.match(result.message, /invalid api key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('测试视觉模型：Key 是网址时直接给提示，不发请求', async () => {
  const { dir, paths } = fixture();
  try {
    let called = false;
    const result = await testVision(
      paths,
      { apiKey: 'https://api.openai.com/v1' },
      {
        fetchImpl: async () => {
          called = true;
          return response({});
        },
      },
    );
    assert.equal(result.ok, false);
    assert.match(result.message, /网址/);
    assert.equal(called, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DeepSeek 地址会被拦下（不支持图片输入）', async () => {
  const { dir, paths } = fixture();
  try {
    const result = await testVision(
      paths,
      { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'sk-x' },
      {
        fetchImpl: async () => {
          throw new Error('不应该发请求');
        },
      },
    );
    assert.equal(result.ok, false);
    assert.match(result.message, /不支持图片输入/);

    const message = validateApiKeys({ vision: { baseUrl: 'https://api.deepseek.com' } });
    assert.match(message, /不支持图片输入/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
