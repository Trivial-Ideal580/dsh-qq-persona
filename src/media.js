/**
 * 多模态：把 QQ 消息里的图片、语音、文件转成模型能读的文字。
 *
 * QQ 开放平台给的是附件 URL；这里做三件事：
 *   1. 语音：直接用平台给的 asr_refer_text（QQ 自己转好的文字）
 *   2. 图片：下载后交给一个 OpenAI 兼容的视觉模型，拿一句客观描述
 *   3. 文件：如果是文本类且不大，直接读出内容（截断）
 *
 * 视觉模型是可选的：不配 apiKey 就退化成“[图片]”，不会报错、不会阻塞回复。
 */
import { setTimeout as delay } from 'node:timers/promises';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.csv', '.tsv', '.log',
  '.yaml', '.yml', '.ini', '.conf', '.toml', '.xml', '.html', '.htm',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h',
  '.cpp', '.cs', '.go', '.rs', '.sh', '.ps1', '.sql',
]);

const MAX_CACHE = 200;

function extensionOf(name = '') {
  const index = String(name).lastIndexOf('.');
  return index >= 0 ? String(name).slice(index).toLowerCase() : '';
}

export function kindOf(attachment) {
  const type = String(attachment?.content_type ?? attachment?.contentType ?? '').toLowerCase();
  if (type.startsWith('image') || type === 'image') return 'image';
  if (type.startsWith('voice') || type === 'audio' || type.startsWith('audio')) return 'voice';
  if (type.startsWith('video')) return 'video';
  if (type === 'file' || type.startsWith('file')) return 'file';
  if (TEXT_EXTENSIONS.has(extensionOf(attachment?.filename))) return 'file';
  return 'other';
}

/** 文本类文件解码；二进制返回 undefined。 */
export function extractTextFile(buffer, filename = '', maxBytes = 65536) {
  if (!buffer || buffer.length === 0) return undefined;
  const slice = buffer.subarray(0, Math.min(buffer.length, maxBytes));
  const text = slice.toString('utf8');
  if (!text) return undefined;
  const replacement = (text.match(/\uFFFD/g) ?? []).length;
  if (replacement > Math.max(8, text.length * 0.02)) return undefined;
  if (text.includes('\u0000')) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const truncated = buffer.length > maxBytes;
  return truncated ? `${trimmed}\n…（文件较大，只读了前 ${Math.round(maxBytes / 1024)} KB）` : trimmed;
}

export function describeImagePrompt(config) {
  return (
    config?.prompt ||
    '用一两句中文客观描述这张图片：画面里有什么、有没有文字（有就摘录关键文字）。不要推测、不要评价。'
  );
}

/** 视觉模型请求体（OpenAI 兼容）。 */
export function buildVisionRequest({ model, prompt, dataUrl, maxTokens = 300 }) {
  return {
    model,
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };
}

export class MediaUnderstanding {
  constructor({ config, logger, fetchImpl }) {
    this.config = config ?? {};
    this.logger = logger;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.cache = new Map();
    this.warned = false;
  }

  get vision() {
    return this.config.vision ?? {};
  }

  apiKey() {
    return String(this.vision.apiKey || process.env.VISION_API_KEY || '').trim();
  }

  /** DeepSeek 的 chat 模型不支持图片输入，别浪费请求。 */
  visionUnsupported() {
    return /api\.deepseek\.com/i.test(String(this.vision.baseUrl ?? ''));
  }

  /** 把一组附件变成若干行上下文。 */
  async describe(attachments = []) {
    const lines = [];
    for (const attachment of attachments) {
      const kind = kindOf(attachment);
      try {
        if (kind === 'image') lines.push(await this.imageLine(attachment));
        else if (kind === 'voice') lines.push(this.voiceLine(attachment));
        else if (kind === 'file') lines.push(await this.fileLine(attachment));
        else if (kind === 'video') lines.push(`[视频：${attachment.filename ?? '未命名'}]`);
      } catch (error) {
        this.logger?.warn?.(`附件处理失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return lines.filter(Boolean);
  }

  voiceLine(attachment) {
    const asr = String(attachment?.asr_refer_text ?? '').trim();
    if (asr) return `[语音转文字：${asr}]`;
    return '[语音（平台没有给转写文字，你没听清）]';
  }

  async imageLine(attachment) {
    const name = attachment?.filename ?? '图片';
    if (this.vision.enabled === false) return `[图片：${name}]`;
    if (this.visionUnsupported()) {
      if (!this.warnedDeepseek) {
        this.warnedDeepseek = true;
        this.logger?.warn?.(
          '视觉模型地址是 DeepSeek，但 DeepSeek 不支持图片输入；图片会以占位符交给模型。请换支持视觉的服务。',
        );
      }
      return `[图片：${name}（视觉模型不支持看图）]`;
    }
    if (!this.apiKey()) {
      if (!this.warned) {
        this.warned = true;
        this.logger?.info?.('没有配置视觉模型（vision.apiKey），图片会以占位符形式告诉模型');
      }
      return `[图片：${name}（没有配置视觉模型，看不到内容）]`;
    }

    const url = attachment?.url;
    if (!url) return `[图片：${name}]`;

    const cached = this.cache.get(url);
    if (cached) return `[图片内容：${cached}]`;

    const maxBytes = Number(this.vision.maxImageBytes) || 8_000_000;
    const buffer = await this.download(url, maxBytes);
    if (!buffer) return `[图片：${name}（下载失败）]`;

    const mime = String(attachment?.content_type ?? 'image/jpeg').startsWith('image/')
      ? attachment.content_type
      : 'image/jpeg';
    const description = await this.describeImage(buffer, mime);
    if (!description) return `[图片：${name}（识别失败）]`;

    const maxChars = Number(this.vision.maxChars) || 300;
    const clipped = description.length > maxChars ? `${description.slice(0, maxChars)}…` : description;
    this.remember(url, clipped);
    return `[图片内容：${clipped}]`;
  }

  async fileLine(attachment) {
    const name = attachment?.filename ?? '文件';
    const size = Number(attachment?.size) || 0;
    const readable =
      this.config.media?.readTextFiles !== false &&
      (TEXT_EXTENSIONS.has(extensionOf(name)) ||
        String(attachment?.content_type ?? '').startsWith('text/'));
    if (!readable || !attachment?.url) {
      return `[文件：${name}${size ? `（${Math.round(size / 1024)} KB）` : ''}]`;
    }

    const maxBytes = Number(this.config.media?.maxTextFileBytes) || 65536;
    const buffer = await this.download(attachment.url, maxBytes + 1);
    if (!buffer) return `[文件：${name}（下载失败）]`;
    const text = extractTextFile(buffer, name, maxBytes);
    if (!text) return `[文件：${name}（不是文本或读不了）]`;
    return `[文件 ${name} 的内容：\n${text}\n]`;
  }

  remember(url, description) {
    if (this.cache.size >= MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(url, description);
  }

  async download(url, maxBytes) {
    try {
      const response = await this.fetch(url, {
        signal: AbortSignal.timeout(Number(this.vision.timeoutMs) || 20_000),
      });
      if (!response.ok) return undefined;
      const length = Number(response.headers?.get?.('content-length') ?? 0);
      if (length > maxBytes) return undefined;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > maxBytes) return undefined;
      return buffer;
    } catch (error) {
      this.logger?.warn?.(`下载附件失败：${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  async describeImage(buffer, mime) {
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    const baseUrl = String(this.vision.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const body = buildVisionRequest({
      model: this.vision.model || 'gpt-4o-mini',
      prompt: describeImagePrompt(this.vision),
      dataUrl,
      maxTokens: Number(this.vision.maxTokens) || 300,
    });

    try {
      const response = await this.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey()}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(this.vision.timeoutMs) || 20_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger?.warn?.(`视觉模型返回 ${response.status}：${detail.slice(0, 200)}`);
        return undefined;
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content === 'string') return content.trim();
      if (Array.isArray(content)) {
        return content
          .map((item) => (typeof item === 'string' ? item : item?.text ?? ''))
          .join('')
          .trim();
      }
      return undefined;
    } catch (error) {
      this.logger?.warn?.(`视觉模型调用失败：${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}

/** 测试/重试时用的小工具。 */
export const sleep = delay;
