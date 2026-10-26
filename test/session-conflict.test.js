import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePersona } from '../src/persona.js';
import { PeerSessions } from '../src/session.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const persona = normalizePersona({ id: 'p', name: 'p' }, 'p.yaml');

function makeAgents(behaviour) {
  const calls = { resume: 0, create: [] };
  return {
    calls,
    get: () => undefined,
    async resume() {
      calls.resume += 1;
      throw new Error('session not found');
    },
    async create(options) {
      calls.create.push(options.sessionId);
      return behaviour(options, calls.create.length);
    },
  };
}

function makeSessions(agents, extras = {}) {
  const salts = {
    data: {},
    get(key) {
      return this.data[key];
    },
    rotate(key) {
      this.data[key] = `salt-${Math.random().toString(36).slice(2, 8)}`;
      return this.data[key];
    },
  };
  return new PeerSessions({
    ctx: { agents },
    config: {},
    personas: { resolve: () => persona },
    overrides: { get: () => undefined },
    logger: silent,
    appId: 'app',
    salts,
    ...extras,
  });
}

function fakeAgent() {
  return { followup() {}, cancel() {}, session: { events: [] } };
}

const input = (personaOverride = persona) => ({
  scope: 'group',
  peerId: 'g1',
  senderName: '阿伟',
  replyTarget: { scope: 'group', targetId: 'g1', msgId: 'm1' },
  persona: personaOverride,
});

test('会话 id 冲突时换新 id 重试，不让群聊永久失败', async () => {
  const agents = makeAgents((options, attempt) => {
    if (attempt === 1) {
      throw new Error(`session "${options.sessionId}" already exists`);
    }
    return { agent: fakeAgent(), dispose: async () => {} };
  });
  const sessions = makeSessions(agents);
  const firstId = sessions.sessionIdFor('group', 'g1');

  const record = await sessions.getOrCreate(input());
  assert.equal(agents.calls.create.length, 2, '应该 create 两次');
  assert.notEqual(agents.calls.create[1], firstId, '第二次应换一个 sessionId');
  assert.equal(record.sessionId, agents.calls.create[1]);
  assert.equal(record.sessionId, sessions.sessionIdFor('group', 'g1'), '新盐值要持久化');
  await sessions.disposeAll();
});

test('同一群并发消息只创建一次会话', async () => {
  const agents = makeAgents(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { agent: fakeAgent(), dispose: async () => {} };
  });
  const sessions = makeSessions(agents);

  const [a, b] = await Promise.all([sessions.getOrCreate(input()), sessions.getOrCreate(input())]);
  assert.equal(a, b, '应复用同一个会话记录');
  assert.equal(agents.calls.create.length, 1, '并发只应 create 一次');
  assert.equal(agents.calls.resume, 1);
  await sessions.disposeAll();
});

test('换人设会重建代理，但沿用同一个 sessionId', async () => {
  const agents = makeAgents(() => ({ agent: fakeAgent(), dispose: async () => {} }));
  const sessions = makeSessions(agents);

  const first = await sessions.getOrCreate(input());
  const other = { ...persona, id: 'q' };
  const second = await sessions.getOrCreate(input(other));

  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.persona.id, 'q');
  assert.equal(agents.calls.create.length, 2);
  await sessions.disposeAll();
});
