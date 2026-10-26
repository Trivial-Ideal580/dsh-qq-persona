import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildImageRequest,
  extractImageRequests,
  ImageGenerator,
  parseImageResponse,
  sniffImageExtension,
} from '../src/imagegen.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function response({ status = 200, body = {}, bytes = undefined, text = undefined } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
    arrayBuffer: async () => Uint8Array.from(bytes ?? Buffer.from('x')).buffer,
  };
}

test('请求体同时兼容 OpenAI 与硅基流动字段', () => {
  const body = buildImageRequest({ model: 'm', prompt: '猫', size: '1024x1024' });
  assert.equal(body.model, 'm');
  assert.equal(body.prompt, '猫');
  assert.equal(body.size, '1024x1024');
  assert.equal(body.image_size, '1024x1024');
  assert.equal(body.n, 1);
});

test('解析响应：b64 / url / images', () => {
  assert.deepEqual(parseImageResponse({ data: [{ b64_json: 'AAA' }] }), { b64: 'AAA' });
  assert.deepEqual(parseImageResponse({ data: [{ url: 'https://x/a.png' }] }), { url: 'https://x/a.png' });
  assert.deepEqual(parseImageResponse({ images: [{ url: 'https://x/b.png' }] }), { url: 'https://x/b.png' });
  assert.deepEqual(parseImageResponse({ data: ['https://x/c.png'] }), { url: 'https://x/c.png' });
  assert.equal(parseImageResponse({}), undefined);
});

test('从模型输出里抠出 [[IMAGE]] 标记', () => {
  const result = extractImageRequests('在呢\n[[IMAGE: 一只橘猫趴在键盘上]]\n好看吗');
  assert.deepEqual(result.prompts, ['一只橘猫趴在键盘上']);
  assert.equal(result.text, '在呢\n\n好看吗');

  assert.deepEqual(extractImageRequests('[[draw: 海边日落]]').prompts, ['海边日落']);
  assert.deepEqual(extractImageRequests('[[画图：赛博朋克街道]]').prompts, ['赛博朋克街道']);
  assert.deepEqual(extractImageRequests('没有标记').prompts, []);
});

test('同一句里重复标记只画一次', () => {
  const { prompts } = extractImageRequests('[[IMAGE: 猫]] [[image: 猫]]');
  assert.deepEqual(prompts, ['猫']);
});

test('按文件头猜后缀', () => {
  assert.equal(sniffImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'png');
  assert.equal(sniffImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(sniffImageExtension(Buffer.from('RIFF....WEBP')), 'webp');
});

test('生成 b64 图片', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(url, /\/images\/generations$/);
    assert.match(options.headers.authorization, /^Bearer /);
    return response({ body: { data: [{ b64_json: Buffer.from('fake-png').toString('base64') }] } });
  };
  const generator = new ImageGenerator({
    config: { imagegen: { apiKey: 'sk-1', baseUrl: 'https://img.test/v1', model: 'm' } },
    logger: silent,
    fetchImpl,
  });
  const image = await generator.generate('猫');
  assert.equal(image.buffer.toString(), 'fake-png');
  assert.equal(image.extension, 'png');
});

test('生成 url 图片需要下载', async () => {
  let downloads = 0;
  const fetchImpl = async (url) => {
    if (url === 'https://img.test/v1/images/generations') {
      return response({ body: { data: [{ url: 'https://cdn.test/a.png' }] } });
    }
    downloads += 1;
    return response({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]) });
  };
  const generator = new ImageGenerator({
    config: { imagegen: { apiKey: 'sk-1', baseUrl: 'https://img.test/v1' } },
    logger: silent,
    fetchImpl,
  });
  const image = await generator.generate('猫');
  assert.equal(downloads, 1);
  assert.equal(image.extension, 'png');
});

test('接口报错会抛出可读信息', async () => {
  const generator = new ImageGenerator({
    config: { imagegen: { apiKey: 'sk-1' } },
    logger: silent,
    fetchImpl: async () => response({ status: 400, text: 'bad prompt' }),
  });
  await assert.rejects(() => generator.generate('猫'), /400/);
});

test('没配 Key 时 enabled 为 false，生成会报错', async () => {
  const generator = new ImageGenerator({ config: { imagegen: {} }, logger: silent, fetchImpl: async () => response() });
  assert.equal(generator.enabled, false);
  await assert.rejects(() => generator.generate('猫'), /没有配置画图模型/);
});
