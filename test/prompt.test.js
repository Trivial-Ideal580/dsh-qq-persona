import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizePersona, resolveReplyStyle } from '../src/persona.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { parseYaml } from '../src/util.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const load = (name) =>
  normalizePersona(parseYaml(readFileSync(join(root, 'personas', name), 'utf8')), name);

test('人设补全默认值', () => {
  const persona = normalizePersona({ id: 'test', name: '测试' }, 'test.yaml');
  assert.equal(persona.reply.maxBubbles, 2);
  assert.equal(persona.reply.maxCharsPerBubble, 40);
  assert.equal(persona.style.emojiRate, 0.2);
  assert.deepEqual(persona.personality, []);
  assert.equal(persona.enabled, true);
});

test('人设校验：没写 name 时用 id 兜底', () => {
  const persona = normalizePersona({ id: 'x' }, 'x.yaml');
  assert.equal(persona.name, 'x');
  assert.throws(() => normalizePersona([], 'x.yaml'), /不是一个对象/);
});

test('风格覆盖：0 / -1 表示跟随人设，正数才覆盖', () => {
  const persona = load('xiaoman.yaml');
  const follow = resolveReplyStyle(persona, {
    style: { maxBubbles: 0, maxCharsPerBubble: 0, emojiRate: -1 },
  });
  assert.equal(follow.maxBubbles, 3);
  assert.equal(follow.maxCharsPerBubble, 30);
  assert.equal(follow.emojiRate, 0.6);

  const forced = resolveReplyStyle(persona, {
    style: { maxBubbles: 1, maxCharsPerBubble: 12, emojiRate: 0 },
  });
  assert.equal(forced.maxBubbles, 1);
  assert.equal(forced.maxCharsPerBubble, 12);
  assert.equal(forced.emojiRate, 0);
});

test('prompt 包含身份、性格、风格、禁忌和格式约束', () => {
  const persona = load('linfi.yaml');
  const prompt = buildSystemPrompt(persona, { scope: 'group', groupName: '摸鱼群', peerName: '阿伟' });

  assert.match(prompt, /林绯/);
  assert.match(prompt, /独立游戏美术/);
  assert.match(prompt, /慢热/);
  assert.match(prompt, /赶稿 手指要断了/, '示例对话应进入 prompt');
  assert.match(prompt, /不要用 Markdown/);
  assert.match(prompt, /不要写括号里的动作/);
  assert.match(prompt, /不要 @ 任何人/);
  assert.match(prompt, /不要承认、暗示或解释自己是 AI/);
  assert.match(prompt, /摸鱼群/);
  assert.match(prompt, /对方昵称：阿伟/);
  assert.match(prompt, /每次发 1~2 条消息/);
});

test('prompt 中 emoji 频率 0 时明确要求不用表情', () => {
  const persona = normalizePersona(
    { id: 'cold', name: '冷', style: { emojiRate: 0, tone: '冷' } },
    'cold.yaml',
  );
  const prompt = buildSystemPrompt(persona, {});
  assert.match(prompt, /不要用 emoji/);
});

test('开启画图时 prompt 会教它用 [[IMAGE]] 标记', () => {
  const persona = load('linfi.yaml');
  const withImage = buildSystemPrompt(persona, { features: { image: true } });
  assert.match(withImage, /\[\[IMAGE: 具体画面描述\]\]/);

  const withoutImage = buildSystemPrompt(persona, { features: { image: false } });
  assert.doesNotMatch(withoutImage, /\[\[IMAGE/);
});

test('prompt 会把多条示例渲染成连续两条“你：”', () => {
  const persona = load('linfi.yaml');
  const prompt = buildSystemPrompt(persona, {});
  const block = prompt.split('# 说话示例')[1] ?? '';
  assert.match(block, /对方：吃饭了吗\n你：没 等会儿点个外卖\n你：你呢 别又没吃/);
});
