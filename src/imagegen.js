/**
 * 画图：调用 OpenAI 兼容的 /images/generations，把结果变成可以直接发到 QQ 的图片。
 *
 * 支持两种常见返回：
 *   - OpenAI：{ data: [{ b64_json }] } 或 { data: [{ url }] }
 *   - 硅基流动等：{ images: [{ url }] }
 */

const MAX_IMAGE_BYTES = 20_000_000;

export function buildImageRequest({ model, prompt, size }) {
  return {
    model,
    prompt,
    n: 1,
    // OpenAI 用 size，硅基流动用 image_size；多传一个通常会被忽略
    size,
    image_size: size,
    response_format: 'b64_json',
  };
}

/** 从响应里取出图片数据：{ b64 } 或 { url }。 */
export function parseImageResponse(payload) {
  const first = payload?.data?.[0] ?? payload?.images?.[0];
  if (!first) return undefined;
  if (typeof first === 'string') return { url: first };
  if (typeof first.b64_json === 'string' && first.b64_json) return { b64: first.b64_json };
  if (typeof first.url === 'string' && first.url) return { url: first.url };
  if (typeof first.image_url === 'string' && first.image_url) return { url: first.image_url };
  return undefined;
}

/** 按文件头猜后缀；猜不到就 png。 */
export function sniffImageExtension(buffer) {
  if (!buffer || buffer.length < 4) return 'png';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF') return 'webp';
  if (buffer.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return 'png';
}

/** 从模型输出里抠出 [[IMAGE: ...]] 标记。 */
export function extractImageRequests(text) {
  const prompts = [];
  const cleaned = String(text ?? '').replace(
    /\[\[\s*(?:image|draw|画图)\s*[:：]\s*([^\]\n]{1,300})\s*\]\]/gi,
    (_all, prompt) => {
      const value = String(prompt).trim();
      if (value) prompts.push(value);
      return '';
    },
  );
  return {
    text: cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    prompts: [...new Set(prompts)],
  };
}

export class ImageGenerator {
  constructor({ config, logger, fetchImpl }) {
    this.config = config ?? {};
    this.logger = logger;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get settings() {
    return this.config.imagegen ?? {};
  }

  apiKey() {
    return String(this.settings.apiKey || process.env.IMAGE_API_KEY || '').trim();
  }

  get enabled() {
    return this.settings.enabled !== false && Boolean(this.apiKey());
  }

  baseUrl() {
    return String(this.settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  /** 生成一张图，返回 { buffer, mime, extension }。 */
  async generate(prompt) {
    if (!this.apiKey()) throw new Error('没有配置画图模型（imagegen.apiKey / IMAGE_API_KEY）');
    const size = this.settings.size || '1024x1024';
    const body = buildImageRequest({
      model: this.settings.model || 'gpt-image-1',
      prompt: String(prompt).slice(0, 1000),
      size,
    });
    const timeout = Number(this.settings.timeoutMs) || 90_000;

    const response = await this.fetch(`${this.baseUrl()}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`画图接口返回 ${response.status}：${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    const parsed = parseImageResponse(payload);
    if (!parsed) throw new Error('画图接口没有返回图片');

    let buffer;
    if (parsed.b64) {
      buffer = Buffer.from(parsed.b64, 'base64');
    } else {
      const image = await this.fetch(parsed.url, { signal: AbortSignal.timeout(timeout) });
      if (!image.ok) throw new Error(`下载生成的图片失败：${image.status}`);
      const length = Number(image.headers?.get?.('content-length') ?? 0);
      if (length > MAX_IMAGE_BYTES) throw new Error('生成的图片太大');
      buffer = Buffer.from(await image.arrayBuffer());
    }

    if (!buffer || buffer.length === 0) throw new Error('生成的图片是空的');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('生成的图片太大');

    const extension = sniffImageExtension(buffer);
    return {
      buffer,
      extension,
      mime: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
    };
  }
}
