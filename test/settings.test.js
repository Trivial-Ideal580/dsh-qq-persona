import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applySettings, DEFAULT_RUNTIME_SETTINGS, readSettings, writeSettings } from '../src/settings.js';

test('默认设置包含多模态配置', () => {
  assert.equal(DEFAULT_RUNTIME_SETTINGS.vision.enabled, true);
  assert.equal(DEFAULT_RUNTIME_SETTINGS.vision.model, 'gpt-4o-mini');
  assert.equal(DEFAULT_RUNTIME_SETTINGS.media.readTextFiles, true);
  assert.equal(DEFAULT_RUNTIME_SETTINGS.imagegen.enabled, true);
  assert.equal(DEFAULT_RUNTIME_SETTINGS.imagegen.model, 'gpt-image-1');
});

test('applySettings 会叠加画图配置', () => {
  const merged = applySettings(
    { imagegen: { enabled: true, model: 'default', size: '1024x1024' } },
    { imagegen: { model: 'flux', apiKey: 'sk-img' } },
  );
  assert.equal(merged.imagegen.model, 'flux');
  assert.equal(merged.imagegen.apiKey, 'sk-img');
  assert.equal(merged.imagegen.size, '1024x1024');
});

test('applySettings 会叠加 vision / media，而不覆盖未提供的字段', () => {
  const config = {
    personaId: 'linfi',
    vision: { enabled: true, baseUrl: 'https://default/v1', model: 'default-model', maxChars: 300 },
    media: { readTextFiles: true, maxTextFileBytes: 65536 },
    trigger: { requireMention: true },
  };
  const merged = applySettings(config, {
    vision: { model: 'qwen-vl', apiKey: 'sk-1' },
    trigger: { requireMention: false },
  });
  assert.equal(merged.vision.model, 'qwen-vl');
  assert.equal(merged.vision.baseUrl, 'https://default/v1');
  assert.equal(merged.vision.apiKey, 'sk-1');
  assert.equal(merged.media.readTextFiles, true);
  assert.equal(merged.trigger.requireMention, false);
  assert.equal(config.vision.model, 'default-model', '不应修改原对象');
});

test('settings.json 读写 round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qq-persona-settings-'));
  try {
    const file = join(dir, 'settings.json');
    writeSettings(file, { personaId: '小夏', vision: { apiKey: 'sk-test' } });
    const back = readSettings(file);
    assert.equal(back.personaId, '小夏');
    assert.equal(back.vision.apiKey, 'sk-test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
