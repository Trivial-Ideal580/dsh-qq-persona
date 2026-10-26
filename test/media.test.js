import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractTextFile, kindOf, MediaUnderstanding } from '../src/media.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function response({ status = 200, body = {}, bytes = undefined, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => {
      const buffer = bytes ?? Buffer.from(JSON.stringify(body));
      return Uint8Array.from(buffer).buffer;
    },
  };
}

const baseConfig = {
  vision: { enabled: true, apiKey: 'sk-test', baseUrl: 'https://vision.test/v1', model: 'v-model' },
  media: { readTextFiles: true, maxTextFileBytes: 1024 },
};

test('kindOf 识别图片/语音/文件/视频', () => {
  assert.equal(kindOf({ content_type: 'image' }), 'image');
  assert.equal(kindOf({ content_type: 'image/png' }), 'image');
  assert.equal(kindOf({ content_type: 'voice' }), 'voice');
  assert.equal(kindOf({ content_type: 'file', filename: 'a.txt' }), 'file');
  assert.equal(kindOf({ content_type: 'video' }), 'video');
  assert.equal(kindOf({ filename: 'readme.md' }), 'file');
});

test('文本文件解码：正常文本 / 二进制 / 截断', () => {
  assert.equal(extractTextFile(Buffer.from('hello 世界'), 'a.txt'), 'hello 世界');
  assert.equal(extractTextFile(Buffer.from([0, 1, 2, 3, 0, 5]), 'a.bin'), undefined);
  const long = 'a'.repeat(2048);
  const truncated = extractTextFile(Buffer.from(long), 'a.txt', 100);
  assert.ok(truncated.includes('只读了前'));
});

test('语音：优先用平台转写文字', async () => {
  const media = new MediaUnderstanding({ config: baseConfig, logger: silent, fetchImpl: async () => response() });
  const lines = await media.describe([{ content_type: 'voice', asr_refer_text: '你好呀' }]);
  assert.deepEqual(lines, ['[语音转文字：你好呀]']);
});

test('图片：调用视觉模型并缓存结果', async () => {
  let imageDownloads = 0;
  let visionCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/chat/completions')) {
      visionCalls += 1;
      return response({ body: { choices: [{ message: { content: '一只橘猫趴在键盘上' } }] } });
    }
    imageDownloads += 1;
    return response({ bytes: Buffer.from('fake-image') });
  };

  const media = new MediaUnderstanding({ config: baseConfig, logger: silent, fetchImpl });
  const attachment = { content_type: 'image', url: 'https://cdn.test/a.png', filename: 'a.png' };
  const first = await media.describe([attachment]);
  assert.deepEqual(first, ['[图片内容：一只橘猫趴在键盘上]']);
  assert.equal(visionCalls, 1);

  const second = await media.describe([attachment]);
  assert.deepEqual(second, ['[图片内容：一只橘猫趴在键盘上]']);
  assert.equal(visionCalls, 1, '同一张图不应重复调用视觉模型');
  assert.equal(imageDownloads, 1, '同一张图不应重复下载');
});

test('图片：没配 key 时降级为占位符，不报错', async () => {
  const media = new MediaUnderstanding({
    config: { ...baseConfig, vision: { ...baseConfig.vision, apiKey: '' } },
    logger: silent,
    fetchImpl: async () => {
      throw new Error('不应该发请求');
    },
  });
  const lines = await media.describe([{ content_type: 'image', url: 'https://x/a.png', filename: 'a.png' }]);
  assert.match(lines[0], /没有配置视觉模型/);
});

test('图片：视觉接口失败时降级为“识别失败”', async () => {
  const media = new MediaUnderstanding({
    config: baseConfig,
    logger: silent,
    fetchImpl: async (url) => {
      if (url.includes('/chat/completions')) return response({ status: 500, body: 'boom' });
      return response({ bytes: Buffer.from('img') });
    },
  });
  const lines = await media.describe([{ content_type: 'image', url: 'https://x/a.png', filename: 'a.png' }]);
  assert.match(lines[0], /识别失败/);
});

test('图片：DeepSeek 地址直接降级，不发请求（它不支持看图）', async () => {
  let called = false;
  const media = new MediaUnderstanding({
    config: {
      ...baseConfig,
      vision: { ...baseConfig.vision, baseUrl: 'https://api.deepseek.com' },
    },
    logger: silent,
    fetchImpl: async () => {
      called = true;
      return response({});
    },
  });
  const lines = await media.describe([{ content_type: 'image', url: 'https://x/a.png', filename: 'a.png' }]);
  assert.match(lines[0], /不支持看图/);
  assert.equal(called, false);
});

test('文本文件：直接读出内容给模型', async () => {
  const media = new MediaUnderstanding({
    config: baseConfig,
    logger: silent,
    fetchImpl: async () => response({ bytes: Buffer.from('# 标题\n内容') }),
  });
  const lines = await media.describe([
    { content_type: 'file', filename: 'note.md', url: 'https://x/note.md' },
  ]);
  assert.match(lines[0], /\[文件 note\.md 的内容：/);
  assert.match(lines[0], /# 标题/);
});
