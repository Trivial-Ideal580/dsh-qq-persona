/**
 * 工作台的设置与凭据读写。
 *
 * 设置 → ~/.dsh/qq-persona/settings.json（插件启动时叠加到 cordis 配置）
 * 凭据 → <profile>/config.json 的 { credentials: { appId, appSecret } }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_RUNTIME_SETTINGS, readSettings, writeSettings } from '../../src/settings.js';

export function readStudioSettings(paths) {
  const saved = readSettings(paths.settingsFile);
  return {
    ...DEFAULT_RUNTIME_SETTINGS,
    ...saved,
    trigger: { ...DEFAULT_RUNTIME_SETTINGS.trigger, ...(saved.trigger ?? {}) },
    style: { ...DEFAULT_RUNTIME_SETTINGS.style, ...(saved.style ?? {}) },
    vision: { ...DEFAULT_RUNTIME_SETTINGS.vision, ...(saved.vision ?? {}) },
    media: { ...DEFAULT_RUNTIME_SETTINGS.media, ...(saved.media ?? {}) },
    imagegen: { ...DEFAULT_RUNTIME_SETTINGS.imagegen, ...(saved.imagegen ?? {}) },
  };
}

export function saveStudioSettings(paths, input) {
  const current = readSettings(paths.settingsFile);
  const next = {
    ...current,
    ...(input.personaId !== undefined ? { personaId: String(input.personaId) } : {}),
    ...(input.trigger ? { trigger: { ...(current.trigger ?? {}), ...input.trigger } } : {}),
    ...(input.style ? { style: { ...(current.style ?? {}), ...input.style } } : {}),
    ...(input.vision ? { vision: { ...(current.vision ?? {}), ...input.vision } } : {}),
    ...(input.media ? { media: { ...(current.media ?? {}), ...input.media } } : {}),
    ...(input.imagegen ? { imagegen: { ...(current.imagegen ?? {}), ...input.imagegen } } : {}),
  };
  writeSettings(paths.settingsFile, next);
  return next;
}

export function readCredentials(paths) {
  try {
    if (!existsSync(paths.configFile)) return { appId: '', hasSecret: false, source: 'none' };
    const parsed = JSON.parse(readFileSync(paths.configFile, 'utf8'));
    const credentials = parsed?.credentials ?? {};
    return {
      appId: String(credentials.appId ?? parsed.appId ?? ''),
      hasSecret: Boolean(credentials.appSecret ?? parsed.appSecret),
      source: 'config.json',
    };
  } catch {
    return { appId: '', hasSecret: false, source: 'unreadable' };
  }
}

export function saveCredentials(paths, { appId, appSecret } = {}) {
  let parsed = {};
  try {
    if (existsSync(paths.configFile)) parsed = JSON.parse(readFileSync(paths.configFile, 'utf8'));
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  parsed.credentials ??= {};
  if (appId !== undefined) parsed.credentials.appId = String(appId).trim();
  if (appSecret !== undefined && String(appSecret).trim() !== '') {
    parsed.credentials.appSecret = String(appSecret).trim();
  }
  writeFileSync(paths.configFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return readCredentials(paths);
}

function readSecret(paths) {
  try {
    const parsed = JSON.parse(readFileSync(paths.configFile, 'utf8'));
    return String(parsed?.credentials?.appSecret ?? parsed?.appSecret ?? '');
  } catch {
    return '';
  }
}

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Key 看起来像网址时给一句人话，避免再把地址粘进 Key。 */
export function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

export function validateApiKeys(input) {
  for (const [key, label] of [
    ['vision', '视觉模型'],
    ['imagegen', '画图'],
  ]) {
    const value = input?.[key]?.apiKey;
    if (value && looksLikeUrl(value)) {
      return `${label}的 API Key 看起来是一个网址。请把地址填在「地址」栏，Key 填 sk-... 这种密钥。`;
    }
  }
  const baseUrl = String(input?.vision?.baseUrl ?? '');
  if (/api\.deepseek\.com/i.test(baseUrl)) {
    return 'DeepSeek 的模型不支持图片输入，视觉模型要换一个支持看图的服务（如硅基流动 Qwen-VL、OpenAI gpt-4o-mini）。';
  }
  return undefined;
}

/**
 * 用一张 1x1 的图片真打一次视觉接口——401 / 404 / 模型不存在都能当场看出来。
 */
export async function testVision(paths, { baseUrl, model, apiKey } = {}, { fetchImpl } = {}) {
  const saved = readStudioSettings(paths).vision ?? {};
  const base = String(baseUrl || saved.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const name = String(model || saved.model || 'gpt-4o-mini').trim();
  const key = String(apiKey || saved.apiKey || process.env.VISION_API_KEY || '').trim();

  if (!key) return { ok: false, message: '没有填视觉模型 API Key' };
  if (looksLikeUrl(key)) {
    return {
      ok: false,
      message: 'API Key 是一个网址：请把地址填到「视觉模型地址」，Key 填 sk-... 这种密钥',
    };
  }
  if (/api\.deepseek\.com/i.test(base)) {
    return {
      ok: false,
      message: 'DeepSeek 的模型不支持图片输入。请把地址换成支持视觉的服务（如 https://api.siliconflow.cn/v1 + Qwen/Qwen2.5-VL-7B-Instruct）',
    };
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  try {
    const response = await doFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: name,
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '只回复 OK' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `视觉接口返回 ${response.status}：${text.slice(0, 200)}`,
      };
    }
    let content = '';
    try {
      content = String(JSON.parse(text)?.choices?.[0]?.message?.content ?? '');
    } catch {
      // 非 JSON 也算通过，至少鉴权没问题
    }
    return { ok: true, message: `连通正常${content ? `，模型回复：${content.slice(0, 30)}` : ''}` };
  } catch (error) {
    return {
      ok: false,
      message: `连不上视觉接口：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 直接问 QQ 开放平台要 token —— 这是判断“为什么不上线”最快的方法。
 * 返回 { ok, message }。
 */
export async function testCredentials(paths, { appId, appSecret } = {}) {
  const id = String(appId ?? '').trim() || readCredentials(paths).appId;
  const secret = String(appSecret ?? '').trim() || readSecret(paths);
  if (!id || !secret) {
    return { ok: false, message: '还没填 AppID / AppSecret' };
  }

  try {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: id, clientSecret: secret }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json().catch(() => ({}));
    if (data?.access_token) {
      return { ok: true, message: `凭据有效（AppID ${id}），已拿到 access_token` };
    }
    const code = data?.code ?? response.status;
    const message = data?.message ?? '未知错误';
    return {
      ok: false,
      code,
      message: `凭据无效：${message}（code ${code}）。请到 QQ 开放平台核对 AppID 和 AppSecret 是否配套`,
    };
  } catch (error) {
    return { ok: false, message: `连不上 QQ 开放平台：${error instanceof Error ? error.message : String(error)}` };
  }
}
