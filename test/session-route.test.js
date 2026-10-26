import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PeerSessions } from '../src/session.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function makeSessions(ctx) {
  return new PeerSessions({
    ctx,
    config: {},
    personas: { resolve: () => ({ id: 'x', name: 'x', style: {}, reply: {} }) },
    overrides: { get: () => undefined },
    logger: silent,
    appId: 'test',
  });
}

test('默认模型：ctx.get 可用时能解析出路由', () => {
  const ctx = {
    agents: {},
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) };
      }
      throw new Error('unknown service');
    },
  };
  const sessions = makeSessions(ctx);
  assert.deepEqual(sessions.resolveRoute(), {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
  });
  sessions.disposeAll();
});

test('默认模型：属性访问会抛错时不能拖垮 ctx.get（回归保护）', () => {
  const ctx = { agents: {} };
  ctx.get = (name) => {
    if (name === 'agentDefaultModel') {
      return { currentSelection: () => ({ provider: 'p', model: 'm' }) };
    }
    throw new Error('unknown');
  };
  // 模拟 cordis：未注入的服务在属性访问时直接抛错
  Object.defineProperty(ctx, 'agentDefaultModel', {
    get() {
      throw new Error('Service agentDefaultModel not found');
    },
  });

  const sessions = makeSessions(ctx);
  assert.deepEqual(sessions.resolveRoute(), { provider: 'p', model: 'm' });
  sessions.disposeAll();
});

test('默认模型：都拿不到时返回 undefined（由上层提示）', () => {
  const ctx = {
    agents: {},
    get() {
      throw new Error('no service');
    },
  };
  const sessions = makeSessions(ctx);
  assert.equal(sessions.resolveRoute(), undefined);
  sessions.disposeAll();
});

test('显式配置优先于宿主默认模型', () => {
  const ctx = {
    agents: {},
    get: () => ({ currentSelection: () => ({ provider: 'a', model: 'b' }) }),
  };
  const sessions = new PeerSessions({
    ctx,
    config: { provider: 'explicit', model: 'model-x' },
    personas: { resolve: () => ({}) },
    overrides: { get: () => undefined },
    logger: silent,
    appId: 'test',
  });
  assert.deepEqual(sessions.resolveRoute(), { provider: 'explicit', model: 'model-x' });
  sessions.disposeAll();
});
