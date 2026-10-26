/**
 * 运行时设置：给人设工作台用的可编辑配置。
 *
 * 优先级：settings.json > profile 的 cordis 配置 > 默认值。
 * 工作台只写 settings.json，不去改 YAML patch，安全且可回滚。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 工作台保存的设置形状（未填的字段不覆盖 cordis 配置）。 */
export const DEFAULT_RUNTIME_SETTINGS = {
  personaId: '',
  trigger: {
    requireMention: true,
    keywords: [],
    randomChance: 0,
    cooldownSec: 20,
    activeWindowMin: 30,
    historyLimit: 20,
    historyTtlMin: 30,
  },
  style: {
    maxBubbles: 0,
    maxCharsPerBubble: 0,
    emojiRate: -1,
    typingBaseMs: 600,
    typingPerCharMs: 30,
    maxTypingMs: 4000,
    simulateTyping: true,
  },
  vision: {
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    maxChars: 300,
  },
  media: {
    readTextFiles: true,
    maxTextFileBytes: 65536,
  },
  imagegen: {
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-1',
    size: '1024x1024',
  },
};

export function readSettings(file) {
  try {
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSettings(file, settings) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** 把运行时设置叠加到 cordis 配置上（只覆盖出现过的键）。 */
export function applySettings(config, settings = {}) {
  if (!settings || typeof settings !== 'object') return config;
  const merged = { ...config };
  if (settings.personaId) merged.personaId = settings.personaId;
  for (const key of ['trigger', 'style', 'access', 'vision', 'media', 'imagegen']) {
    if (settings[key] && typeof settings[key] === 'object') {
      merged[key] = { ...(config[key] ?? {}), ...settings[key] };
    }
  }
  return merged;
}
