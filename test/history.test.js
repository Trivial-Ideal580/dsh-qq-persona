import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatHistoryBlock, GroupHistory, summarizeForHistory } from '../src/history.js';

test('群消息缓冲：记录、取出后清空', () => {
  const history = new GroupHistory({ limit: 10 });
  history.append('g:1', { name: '阿伟', text: '今天好热' });
  history.append('g:1', { name: '小美', text: '是啊' });

  const taken = history.take('g:1');
  assert.deepEqual(taken.map((e) => e.text), ['今天好热', '是啊']);
  assert.deepEqual(history.take('g:1'), [], '取完应清空');
});

test('群消息缓冲：超过上限只留最近的', () => {
  const history = new GroupHistory({ limit: 3 });
  for (let i = 1; i <= 5; i += 1) history.append('g:1', { name: 'a', text: `m${i}` });
  assert.deepEqual(history.peek('g:1').map((e) => e.text), ['m3', 'm4', 'm5']);
});

test('群消息缓冲：过期的消息会被丢掉', () => {
  const history = new GroupHistory({ limit: 10, ttlMs: 60_000 });
  history.append('g:1', { name: 'a', text: '旧的' });
  history.buffers.get('g:1')[0].ts = Date.now() - 120_000;
  history.append('g:1', { name: 'b', text: '新的' });
  assert.deepEqual(history.peek('g:1').map((e) => e.text), ['新的']);
});

test('群消息缓冲：同一 messageId 重复投递只记一次', () => {
  const history = new GroupHistory({ limit: 10 });
  history.append('g:1', { name: 'a', text: '你好', messageId: 'm1' });
  history.append('g:1', { name: 'a', text: '你好', messageId: 'm1' });
  assert.equal(history.peek('g:1').length, 1);
});

test('不同群的缓冲互不影响', () => {
  const history = new GroupHistory({ limit: 10 });
  history.append('g:1', { name: 'a', text: '一' });
  history.append('g:2', { name: 'b', text: '二' });
  assert.equal(history.take('g:1')[0].text, '一');
  assert.equal(history.peek('g:2')[0].text, '二');
});

test('历史摘要：文字 + 附件类型', () => {
  assert.equal(
    summarizeForHistory({
      content: '看图',
      attachments: [
        { content_type: 'image' },
        { content_type: 'image' },
        { content_type: 'voice' },
      ],
    }),
    '看图 [图片×2] [语音×1]',
  );
  assert.equal(summarizeForHistory({ content: '', attachments: [] }), '');
});

test('历史摘要：去掉 @ 标记', () => {
  assert.equal(summarizeForHistory({ content: '<@ABC123> 你看这个', attachments: [] }), '你看这个');
});

test('上下文块格式', () => {
  const block = formatHistoryBlock([
    { name: '阿伟', text: '今天好热' },
    { name: '小美', text: '是啊' },
  ]);
  assert.equal(block, '[群里刚才的消息]\n阿伟：今天好热\n小美：是啊\n[当前消息]');
  assert.equal(formatHistoryBlock([]), '');
});
