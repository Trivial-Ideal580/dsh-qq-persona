/**
 * 冒烟测试（不需要 QQ、不需要网络）：
 * 验证「人设 → Agent setup → 会话创建 → 消息注入」这条主链路真的能跑通。
 *
 *   node scripts/smoke.mjs
 *
 * 需要先跑一次 `node scripts/dev-link.mjs` 准备依赖。
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PersonaStore, resolveReplyStyle } from '../src/persona.js';
import { PeerSessions } from '../src/session.js';
import { TriggerPolicy } from '../src/trigger.js';
import { renderReply } from '../src/style.js';
import { buildSystemPrompt } from '../src/prompt.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 0. 插件入口可以加载 ────────────────────────────────
const plugin = await import('../index.js');
assert.equal(plugin.name, 'im-qq-persona');
assert.deepEqual(plugin.inject, ['agents']);
assert.equal(typeof plugin.apply, 'function');
assert.equal(typeof plugin.Config, 'function');
console.log('✔ 插件入口导出正常');

// ── 1. 人设加载 ───────────────────────────────────────
const personas = new PersonaStore({ dir: join(ROOT, 'personas'), logger }).load();
assert.equal(personas.size, 2);
assert.deepEqual(personas.list().map((item) => item.id).sort(), ['linfi', 'xiaoman']);
const persona = personas.resolve('linfi');
assert.equal(persona.name, '林绯');
console.log('✔ 人设加载正常');

// ── 2. 人设注入：scoped prompt 章节 + 工具封禁 ─────────
const config = plugin.Config({ appId: 'test-app', personaId: 'linfi', autoQrSetup: false });
config.style = { ...config.style, typingBaseMs: 0, typingPerCharMs: 0, maxTypingMs: 0, simulateTyping: false };

const agents = {
  calls: { create: [], resume: [], dispose: 0 },
  get() {
    return undefined;
  },
  async resume() {
    agents.calls.resume.push(arguments[0]);
    throw new Error('no persisted session');
  },
  async create(options) {
    const agent = {
      followups: [],
      followup(message) {
        this.followups.push(message);
      },
      cancel() {},
      session: { events: [] },
    };
    const previous = agents.created;
    agents.created = agent;
    agents.calls.create.push({ options, agent, previous });
    return { agent, dispose: async () => { agents.calls.dispose += 1; } };
  },
};

const ctx = {
  agents,
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) },
  get: (name) => (name === 'agentDefaultModel' ? ctx.agentDefaultModel : undefined),
  on() {},
  effect() {},
};

const overrides = {
  data: {},
  get(key) {
    return this.data[key];
  },
  set(key, value) {
    this.data[key] = value;
  },
  clear(key) {
    delete this.data[key];
  },
};

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

const sessions = new PeerSessions({ ctx, config, personas, overrides, logger, appId: 'test-app', salts });
const setup = sessions.composeSetup(persona, { scope: 'group', groupName: '摸鱼群', peerName: '阿伟' });

const sections = [];
const guards = [];
const fakeAgentCtx = {
  systemPrompt: {
    section(section) {
      sections.push(section);
    },
  },
  tools: {
    guard(fn) {
      guards.push(fn);
    },
  },
};
await setup(fakeAgentCtx);
assert.equal(sections.length, 1);
assert.equal(sections[0].name, 'deployment:persona');
assert.equal(sections[0].order, 0);
assert.match(sections[0].text, /林绯/);
assert.match(sections[0].text, /摸鱼群/);
assert.equal(guards.length, 1);
assert.match(guards[0](), /不要调用任何工具/);
console.log('✔ 人设 prompt 与工具封禁注入正常');

// ── 3. 会话创建 ───────────────────────────────────────
const record = await sessions.getOrCreate({
  scope: 'group',
  peerId: 'group-openid-1',
  senderName: '阿伟',
  replyTarget: { scope: 'group', targetId: 'group-openid-1', msgId: 'msg-1' },
  persona,
});
assert.equal(agents.calls.resume.length, 1);
assert.equal(agents.calls.create.length, 1);
const createCall = agents.calls.create[0].options;
assert.ok(createCall.sessionId, '应派生 sessionId');
assert.deepEqual(createCall.agentOptions, { provider: 'deepseek-official', model: 'deepseek-flash' });
assert.equal(typeof createCall.setup, 'function');
assert.equal(createCall.meta.cwd, process.cwd());
console.log('✔ 会话创建（fallback create）正常');

// ── 4. 注入用户消息 ───────────────────────────────────
sessions.deliver(record, '阿伟：在干嘛');
const agent = agents.calls.create[0].agent;
assert.equal(agent.followups.length, 1);
const content = agent.followups[0].content;
assert.equal(content[0].type, 'text');
assert.equal(content[0].text, '阿伟：在干嘛');
console.log('✔ 用户消息注入正常');

// ── 5. 复用同一个会话 ─────────────────────────────────
const again = await sessions.getOrCreate({
  scope: 'group',
  peerId: 'group-openid-1',
  replyTarget: { scope: 'group', targetId: 'group-openid-1', msgId: 'msg-2' },
  persona,
});
assert.equal(again, record);
assert.equal(agents.calls.create.length, 1, '不应重复创建');
console.log('✔ 会话复用正常');

// ── 6. 换人设会重建会话，但 sessionId 不变（历史可 resume） ──
const otherPersona = personas.resolve('xiaoman');
await sessions.getOrCreate({
  scope: 'group',
  peerId: 'group-openid-1',
  replyTarget: { scope: 'group', targetId: 'group-openid-1', msgId: 'msg-3' },
  persona: otherPersona,
});
assert.equal(agents.calls.create.length, 2, '换人设应重建');
assert.equal(agents.calls.create[1].options.sessionId, createCall.sessionId, 'sessionId 应保持一致');
console.log('✔ 换人设重建正常');

// ── 6.5 /reset 会换 sessionId（真清空，而不是只丢内存） ──
const beforeReset = sessions.sessionIdFor('group', 'group-openid-1');
await sessions.reset('group', 'group-openid-1');
const afterReset = sessions.sessionIdFor('group', 'group-openid-1');
assert.notEqual(afterReset, beforeReset, 'reset 应派生新的 sessionId');

const fresh = await sessions.getOrCreate({
  scope: 'group',
  peerId: 'group-openid-1',
  replyTarget: { scope: 'group', targetId: 'group-openid-1', msgId: 'msg-4' },
  persona: otherPersona,
});
assert.equal(agents.calls.create.length, 3, 'reset 后应开新会话');
assert.equal(agents.calls.create[2].options.sessionId, afterReset);
assert.equal(fresh.sessionId, afterReset);
console.log('✔ /reset 换新 session（真清空记忆）正常');

// ── 7. 接话策略 + 输出管线的端到端效果 ────────────────
const policy = new TriggerPolicy(config, logger);
assert.equal(policy.decide({ scope: 'group', peerKey: 'g:1', text: '随便说说', wasMentioned: false }).reply, false);
assert.equal(policy.decide({ scope: 'group', peerKey: 'g:1', text: '@它 在吗', wasMentioned: true }).reply, true);
policy.noteReply('g:1');
assert.equal(policy.decide({ scope: 'group', peerKey: 'g:1', text: '在吗', wasMentioned: false }).reason, 'cooldown');

const style = resolveReplyStyle(persona, config);
const bubbles = renderReply('**行吧**（叹气）\n那我先睡了 明天再聊', style);
assert.deepEqual(bubbles, ['行吧', '那我先睡了 明天再聊']);
console.log('✔ 接话策略与输出管线正常');

// ── 8. 网关装配（不启动连接）─────────────────────────
const { startGateway } = await import('../src/gateway.js');
const listeners = {};
const effects = [];
const gatewayCtx = {
  ...ctx,
  on(event, handler) {
    listeners[event] = handler;
  },
  effect(factory) {
    effects.push(factory);
    return () => {};
  },
};
const bot = await startGateway({
  ctx: gatewayCtx,
  config,
  appId: '123456',
  appSecret: 'fake-secret',
  personas,
  sessions,
  policy,
  commands: [],
  logger,
});
assert.ok(bot.getMiddlewares().length >= 5, '应注册中间件链');
assert.equal(typeof listeners['session/event'], 'function', '应监听出站事件');
assert.equal(effects.length, 1, '应注册生命周期 effect');
console.log(`✔ 网关装配正常（${bot.getMiddlewares().length} 层中间件）`);

// ── 9. 插件 apply() 全流程（不启动连接）───────────────
process.env.QQBOT_APPID = '123456';
process.env.QQBOT_SECRET = 'fake-secret';
const applyEffects = [];
const applyEvents = {};
const applyCtx = {
  agents,
  on(event, handler) {
    applyEvents[event] = handler;
  },
  effect(factory) {
    applyEffects.push(factory);
    return () => {};
  },
  get: () => undefined,
  logger,
};
await plugin.apply(applyCtx, plugin.Config({ personaId: 'linfi', autoQrSetup: false }));
assert.ok(applyEffects.length >= 1, 'apply 应注册生命周期');
assert.equal(typeof applyEvents['session/event'], 'function', 'apply 应监听出站');
console.log('✔ apply() 全流程装配正常');

// ── 10. 清场 ──────────────────────────────────────────
await sessions.disposeAll();
assert.equal(agents.calls.dispose, 3);
console.log('✔ 会话释放正常');

// ── 11. 打一份 prompt 样张，方便肉眼检查 ──────────────
if (process.argv.includes('--print-prompt')) {
  console.log('\n──────── system prompt 样张 ────────\n');
  console.log(buildSystemPrompt(persona, { scope: 'group', groupName: '摸鱼群', peerName: '阿伟' }));
}

console.log('\n全部冒烟测试通过。');
