import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBody } from '../src/gateway.js';

test('群聊：接话时把整段群聊上下文带进这一轮', async () => {
  const body = await buildBody(
    { kind: 'group', senderName: '阿伟', content: '@林绯 你说呢' },
    { state: {} },
    undefined,
    [
      { name: '小美', text: '今天好热' },
      { name: '阿伟', text: '空调还坏了' },
    ],
  );
  assert.equal(
    body,
    '[群里刚才的消息]\n小美：今天好热\n阿伟：空调还坏了\n[当前消息]\n阿伟：@林绯 你说呢',
  );
});

test('群聊：没有上下文时就是普通一条消息', async () => {
  const body = await buildBody(
    { kind: 'group', senderName: '阿伟', content: '在吗' },
    { state: {} },
    undefined,
    [],
  );
  assert.equal(body, '阿伟：在吗');
});

test('私聊：不插入群聊标记', async () => {
  const body = await buildBody({ kind: 'c2c', senderName: '阿伟', content: '在吗' }, { state: {} }, undefined, [
    { name: '小美', text: '不该出现' },
  ]);
  assert.equal(body, '在吗');
});

test('群聊：@ 标记不会原样交给模型', async () => {
  const body = await buildBody(
    { kind: 'group', senderName: '阿伟', content: '<@ABC123DEF> 在吗' },
    { state: {} },
    undefined,
    [],
  );
  assert.equal(body, '阿伟：在吗');
});

test('引用消息会带上前文', async () => {
  const body = await buildBody(
    { kind: 'c2c', senderName: '阿伟', content: '这个怎么样' },
    { state: { quote: { text: '新出的那个游戏' } } },
    undefined,
    [],
  );
  assert.match(body, /对方在回复这条：新出的那个游戏/);
  assert.match(body, /这个怎么样/);
});
