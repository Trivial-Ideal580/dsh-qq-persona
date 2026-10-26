import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TriggerPolicy } from '../src/trigger.js';

const config = (trigger = {}) => ({
  trigger: {
    requireMention: true,
    keywords: [],
    randomChance: 0,
    cooldownSec: 20,
    activeWindowMin: 30,
    ...trigger,
  },
});

test('私聊总是接话', () => {
  const policy = new TriggerPolicy(config());
  assert.equal(policy.decide({ scope: 'c2c', peerKey: 'p:1', text: '在吗', wasMentioned: false }).reply, true);
});

test('群聊：@ 一定接', () => {
  const policy = new TriggerPolicy(config());
  const result = policy.decide({ scope: 'group', peerKey: 'g:1', text: '在吗', wasMentioned: true });
  assert.deepEqual(result, { reply: true, reason: 'mention' });
});

test('群聊：未 @ 且无关键词 → 沉默', () => {
  const policy = new TriggerPolicy(config());
  const result = policy.decide({ scope: 'group', peerKey: 'g:1', text: '今天天气不错', wasMentioned: false });
  assert.deepEqual(result, { reply: false, reason: 'silent' });
});

test('群聊：命中唤醒词就接', () => {
  const policy = new TriggerPolicy(config({ keywords: ['林绯', '小夏'] }));
  const result = policy.decide({ scope: 'group', peerKey: 'g:1', text: '林绯在吗', wasMentioned: false });
  assert.equal(result.reply, true);
  assert.equal(result.reason, 'keyword:林绯');
});

test('群聊：冷却期内不接', () => {
  const policy = new TriggerPolicy(config({ requireMention: false, cooldownSec: 60 }));
  assert.equal(policy.decide({ scope: 'group', peerKey: 'g:1', text: 'a', wasMentioned: false }).reply, true);
  policy.noteReply('g:1');
  assert.deepEqual(policy.decide({ scope: 'group', peerKey: 'g:1', text: 'b', wasMentioned: false }), {
    reply: false,
    reason: 'cooldown',
  });
});

test('群聊：@ 不受冷却限制', () => {
  const policy = new TriggerPolicy(config({ cooldownSec: 600 }));
  policy.noteReply('g:1');
  assert.equal(policy.decide({ scope: 'group', peerKey: 'g:1', text: 'a', wasMentioned: true }).reply, true);
});

test('群聊接管模式：未 @ 也回，但受冷却约束', () => {
  const policy = new TriggerPolicy(config({ requireMention: false, cooldownSec: 0 }));
  const result = policy.decide({ scope: 'group', peerKey: 'g:1', text: '随便聊聊', wasMentioned: false });
  assert.deepEqual(result, { reply: true, reason: 'all-messages' });
});

test('群聊随机插话：概率 1 时必中，0 时不中', () => {
  const always = new TriggerPolicy(config({ randomChance: 1, activeWindowMin: 30 }));
  always.noteHuman('g:1');
  assert.equal(
    always.decide({ scope: 'group', peerKey: 'g:1', text: '随便', wasMentioned: false }).reason,
    'random',
  );

  const never = new TriggerPolicy(config({ randomChance: 0 }));
  never.noteHuman('g:1');
  assert.equal(
    never.decide({ scope: 'group', peerKey: 'g:1', text: '随便', wasMentioned: false }).reason,
    'silent',
  );
});

test('群聊随机插话：群里太久没人说话就不插', () => {
  const policy = new TriggerPolicy(config({ randomChance: 1, activeWindowMin: 1 }));
  // 伪造 10 分钟前的最后一条人类消息
  const state = policy.state('g:1');
  state.lastHumanAt = Date.now() - 10 * 60_000;
  assert.equal(
    policy.decide({ scope: 'group', peerKey: 'g:1', text: '随便', wasMentioned: false }).reply,
    false,
  );
});

test('不同群的冷却互不影响', () => {
  const policy = new TriggerPolicy(config({ requireMention: false, cooldownSec: 60 }));
  policy.noteReply('g:1');
  assert.equal(
    policy.decide({ scope: 'group', peerKey: 'g:2', text: 'a', wasMentioned: false }).reply,
    true,
  );
});
