import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEmojiPolicy,
  countEmoji,
  renderReply,
  sanitizeReply,
  splitBubbles,
  typingDelayMs,
} from '../src/style.js';

test('清洗：去掉加粗、列表、标题、引用、行内代码', () => {
  const out = sanitizeReply('**今天**好累\n- 不想动\n# 标题\n> 引用\n`code`');
  assert.equal(out, '今天好累\n不想动\n标题\n引用\ncode');
});

test('清洗：去掉“你：”前缀和整段引号', () => {
  assert.equal(sanitizeReply('你：行吧'), '行吧');
  assert.equal(sanitizeReply('助手: 好的'), '好的');
  assert.equal(sanitizeReply('“笑死”'), '笑死');
});

test('清洗：去掉括号动作，保留正常内容', () => {
  assert.equal(sanitizeReply('（笑）真的假的'), '真的假的');
  assert.equal(sanitizeReply('行吧（沉默了一会儿）'), '行吧');
  assert.equal(sanitizeReply('这个 (1) 挺好'), '这个 (1) 挺好');
});

test('清洗：去掉开头的 @ 人（群里默认不 @）', () => {
  assert.equal(sanitizeReply('@阿伟 在的'), '在的');
  assert.equal(sanitizeReply('<@!123456> 在的'), '在的');
  assert.equal(sanitizeReply('@全体成员 开会了'), '开会了');
  // 正文中间的 @ 不动
  assert.equal(sanitizeReply('你@我干嘛'), '你@我干嘛');
});

test('清洗：整段代码块丢弃', () => {
  assert.equal(sanitizeReply('看这个\n```js\nconsole.log(1)\n```\n'), '看这个');
});

test('分条：一句话就是一条', () => {
  assert.deepEqual(splitBubbles('在干嘛', { maxBubbles: 2, maxCharsPerBubble: 40 }), ['在干嘛']);
});

test('分条：按句号拆成多条，条数受限', () => {
  const long = '今天下班的时候老板又临时改了需求，我改到八点才走，饭都没吃。累死了。真的想睡觉，明天还要早起。';
  const bubbles = splitBubbles(long, { maxBubbles: 2, maxCharsPerBubble: 40 });
  assert.equal(bubbles.length, 2);
  assert.ok(bubbles.every((bubble) => [...bubble].length <= 40));
});

test('分条：多行直接一行一条', () => {
  assert.deepEqual(splitBubbles('没\n你呢 别又没吃', { maxBubbles: 2, maxCharsPerBubble: 40 }), [
    '没',
    '你呢 别又没吃',
  ]);
});

test('分条：超长单句被硬截断', () => {
  const long = '这是一句特别特别长的话'.repeat(10);
  const bubbles = splitBubbles(long, { maxBubbles: 1, maxCharsPerBubble: 20 });
  assert.equal(bubbles.length, 1);
  assert.ok([...bubbles[0]].length <= 20);
});

test('分条：关闭分条时只发一条', () => {
  const bubbles = splitBubbles('第一句。第二句。', {
    maxBubbles: 3,
    maxCharsPerBubble: 40,
    splitBubbles: false,
  });
  assert.equal(bubbles.length, 1);
});

test('emoji：频率为 0 时全部去掉', () => {
  const out = applyEmojiPolicy(['好耶😅', '在吗🙃'], 0, () => 0);
  assert.deepEqual(out, ['好耶', '在吗']);
});

test('emoji：频率为 1 时保留，但一条最多留 2 个', () => {
  const kept = applyEmojiPolicy(['好耶😅'], 1, () => 0);
  assert.equal(kept[0], '好耶😅');
  const trimmed = applyEmojiPolicy(['😅😅😅😅'], 1, () => 0);
  assert.equal(trimmed[0], '');
});

test('renderReply：清洗 + 分条 + emoji 一条龙', () => {
  const out = renderReply('**行吧**（叹气）\n那我先睡了', {
    maxBubbles: 2,
    maxCharsPerBubble: 40,
    emojiRate: 0,
  });
  assert.deepEqual(out, ['行吧', '那我先睡了']);
});

test('打字延迟：随字数增长并封顶', () => {
  const style = {
    simulateTyping: true,
    typingBaseMs: 600,
    typingPerCharMs: 30,
    maxTypingMs: 2000,
  };
  const short = typingDelayMs('在', style, () => 0.5);
  const long = typingDelayMs('在'.repeat(200), style, () => 0.5);
  assert.ok(short > 0);
  assert.ok(short < long);
  assert.equal(long, 2000);
  assert.equal(typingDelayMs('在', { ...style, simulateTyping: false }), 0);
});

test('countEmoji', () => {
  assert.equal(countEmoji('a😅b🙃'), 2);
  assert.equal(countEmoji('没有表情'), 0);
});
