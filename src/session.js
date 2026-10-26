/**
 * 会话管理：一个 QQ 私聊对象 / 一个群 → 一个 DSH Agent。
 *
 * 人设不是“每轮拼进 prompt”，而是在 Agent 创建时注册成一个 scoped
 * system-prompt 章节（deployment:persona），这样：
 *   - 会话历史、工具、压缩都由 DSH 负责；
 *   - 重启后 resume 同一个 sessionId，记忆还在；
 *   - 换人设只要重建这个 Agent，历史照样接得上。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildSystemPrompt } from './prompt.js';
import { resolveReplyStyle } from './persona.js';
import { errorText, sha256Hex } from './util.js';

/** 把任意字符串派生成 UUID 形态的 sessionId（DSH 要求这个格式）。 */
function deriveSessionId(key) {
  const hash = sha256Hex(key);
  return SessionId(
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`,
  );
}

/**
 * 每个 peer 的会话盐值。`/reset` 时换一个盐 → 派生出一个全新的 sessionId，
 * 从而真正开始一段没有历史的新会话（旧会话仍留在磁盘上，不影响）。
 */
export class SessionSalts {
  constructor(file, logger) {
    this.file = resolve(file);
    this.logger = logger;
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (!existsSync(this.file)) return;
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') this.data = parsed;
    } catch (error) {
      this.logger?.warn?.(`会话盐值读取失败：${errorText(error)}`);
    }
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    } catch (error) {
      this.logger?.warn?.(`会话盐值写入失败：${errorText(error)}`);
    }
  }

  get(key) {
    return this.data[key];
  }

  rotate(key) {
    const salt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.data[key] = salt;
    this.save();
    return salt;
  }
}

export class PeerSessions {
  constructor({ ctx, config, personas, overrides, logger, appId, salts }) {
    this.ctx = ctx;
    this.config = config;
    this.personas = personas;
    this.overrides = overrides;
    this.salts = salts;
    this.logger = logger;
    this.appId = appId ?? config.appId;
    this.agents = ctx.agents;
    /** @type {Map<string, object>} */
    this.records = new Map();
    /** 同一个 peer 正在创建中的会话，避免并发 create 撞 id */
    this.pending = new Map();
    this.timer = setInterval(() => this.evictIdle(), 60_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  key(scope, peerId) {
    return `qqpersona:${this.appId}:${scope}:${peerId}`;
  }

  /** 会话 id：key（+ /reset 后的 salt）确定性派生，重启后能 resume 回来。 */
  sessionIdFor(scope, peerId) {
    const key = this.key(scope, peerId);
    const salt = this.salts?.get(key);
    return deriveSessionId(salt ? `${key}#${salt}` : key);
  }

  /** 这条消息该用哪个人设：本会话覆盖 > 全局默认。 */
  personaFor(peerKey) {
    const overrideId = this.overrides.get(peerKey);
    return this.personas.resolve(overrideId ?? this.config.personaId);
  }

  resolveRoute() {
    const { provider, model } = this.config;
    if (provider && model) return { provider, model };

    // 注意：直接读 ctx.agentDefaultModel 在某些 cordis 版本里会抛“服务未注入”，
    // 必须先用 ctx.get() 安全取，再降级到属性访问。
    const candidates = [];
    try {
      candidates.push(this.ctx.get?.('agentDefaultModel'));
    } catch {
      // 服务不存在
    }
    try {
      candidates.push(this.ctx.agentDefaultModel);
    } catch {
      // 属性访问被代理拦截
    }

    for (const service of candidates) {
      try {
        const selection = service?.currentSelection?.();
        if (selection?.provider && selection?.model) {
          return { provider: selection.provider, model: selection.model };
        }
      } catch {
        // 换下一个来源
      }
    }
    return undefined;
  }

  /** 把人设 + 场景写成 scoped prompt，并（默认）封掉工具。 */
  composeSetup(persona, scene) {
    const replyStyle = resolveReplyStyle(persona, this.config);
    const imageEnabled = Boolean(
      this.config.imagegen?.enabled !== false &&
        String(this.config.imagegen?.apiKey || process.env.IMAGE_API_KEY || '').trim(),
    );
    const prompt = buildSystemPrompt(persona, {
      ...scene,
      replyStyle,
      features: { image: imageEnabled },
    });
    const toolsEnabled = this.config.toolsEnabled === true;
    const logger = this.logger;

    return (agentCtx) => {
      try {
        agentCtx.systemPrompt.section({
          name: 'deployment:persona',
          order: 0,
          text: prompt,
        });
      } catch (error) {
        logger.warn(`注册人设 prompt 失败：${errorText(error)}`);
      }
      if (!toolsEnabled && typeof agentCtx.tools?.guard === 'function') {
        agentCtx.tools.guard(
          () => 'QQ 人设聊天模式：不要调用任何工具，直接用聊天文字回复对方。',
        );
      }
    };
  }

  /**
   * 取得（或创建）某个 peer 的会话。
   * @param {{scope: 'c2c'|'group', peerId: string, senderName?: string,
   *          replyTarget: {scope: string, targetId: string, msgId?: string},
   *          groupName?: string, persona: object}} input
   */
  async getOrCreate(input) {
    const key = this.key(input.scope, input.peerId);
    const existing = this.records.get(key);
    if (existing && existing.persona.id === input.persona.id) {
      existing.replyTarget = input.replyTarget;
      existing.lastActivity = Date.now();
      existing.senderName = input.senderName || existing.senderName;
      return existing;
    }

    // 同一个 peer 的创建必须串行：并发 create 同一个 sessionId 会报 already exists
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.open(input).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async open({ scope, peerId, senderName = '', replyTarget, groupName = '', persona }) {
    const key = this.key(scope, peerId);
    if (this.records.has(key)) {
      // 人设被换掉了：重建 Agent（历史走 resume，不丢）
      await this.remove(scope, peerId, { quiet: true });
    }

    let sessionId = this.sessionIdFor(scope, peerId);
    const scene = { scope, groupName, peerName: senderName };
    const setup = this.composeSetup(persona, scene);
    const route = this.resolveRoute();
    if (route) {
      this.logger.info(`模型路由：${route.provider}/${route.model}`);
    } else {
      this.logger.warn(
        '没能解析出默认模型（provider/model），本轮大概率会失败。可在 cordis.patch.yml 里给 im-qq-persona 配 provider/model。',
      );
    }

    let agent;
    let handle;
    const live = this.agents.get(sessionId);
    if (live) {
      agent = live;
      handle = { agent, dispose: async () => {} };
    } else {
      const opened = await this.openAgent({ scope, peerId, sessionId, setup, route, persona });
      sessionId = opened.sessionId;
      agent = opened.agent;
      handle = opened.handle;
    }

    const record = {
      key,
      sessionId,
      agent,
      handle,
      scope,
      peerId,
      senderName,
      groupName,
      replyTarget,
      persona,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      sendChain: Promise.resolve(),
    };
    this.records.set(key, record);
    return record;
  }

  /** resume → create → （会话 id 冲突时）换新 id 再 create。 */
  async openAgent({ scope, peerId, sessionId, setup, route, persona }) {
    const key = this.key(scope, peerId);
    const createOptions = (targetId) => ({
      sessionId: targetId,
      meta: { cwd: this.config.cwd || process.cwd() },
      ...(route ? { agentOptions: route } : {}),
      setup,
    });

    try {
      const resumed = await this.agents.resume({
        resumeSessionId: sessionId,
        ...(route ? { agentOptions: route } : {}),
        setup,
      });
      this.logger.debug(`会话恢复 key=${key} persona=${persona.id}`);
      return { agent: resumed.agent, handle: resumed, sessionId };
    } catch (error) {
      this.logger.debug(`resume 失败，改为新建：${errorText(error)}`);
    }

    try {
      const created = await this.agents.create(createOptions(sessionId));
      this.logger.info(`新建会话 key=${key} persona=${persona.id}`);
      return { agent: created.agent, handle: created, sessionId };
    } catch (error) {
      if (!/already exists/i.test(errorText(error))) throw error;
      // 会话文件还在但恢复不了：换一个全新 sessionId，旧记录留在磁盘上不影响
      const freshId = this.rotateSessionId(scope, peerId);
      this.logger.warn(`会话 ${sessionId} 无法恢复且 id 冲突，已换用新会话 ${freshId}`);
      const created = await this.agents.create(createOptions(freshId));
      return { agent: created.agent, handle: created, sessionId: freshId };
    }
  }

  rotateSessionId(scope, peerId) {
    const key = this.key(scope, peerId);
    if (this.salts?.rotate) {
      this.salts.rotate(key);
      return this.sessionIdFor(scope, peerId);
    }
    return deriveSessionId(`${key}#${randomUUID()}`);
  }

  findBySessionId(sessionId) {
    for (const record of this.records.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  /** 注入一条用户消息。 */
  deliver(record, text) {
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    });
    record.agent.followup(message);
  }

  async remove(scope, peerId, { quiet = false } = {}) {
    const key = this.key(scope, peerId);
    const record = this.records.get(key);
    if (!record) return;
    this.records.delete(key);
    try {
      record.agent.cancel({ kind: 'user' });
    } catch {
      // 忽略
    }
    try {
      await record.handle.dispose();
    } catch (error) {
      if (!quiet) this.logger.warn(`会话释放失败：${errorText(error)}`);
    }
  }

  /**
   * 真正的「清空记忆」：换一个 salt → 换一个 sessionId，
   * 旧会话留在磁盘上但不再被读取，下次消息会开一个全新会话。
   */
  async reset(scope, peerId) {
    this.salts?.rotate(this.key(scope, peerId));
    await this.remove(scope, peerId, { quiet: true });
    this.logger?.info?.(`已重置会话 ${scope}:${peerId}`);
  }

  evictIdle() {
    const timeout = Math.max(60_000, this.config.sessionIdleTimeout ?? 1_800_000);
    const now = Date.now();
    for (const [key, record] of this.records) {
      if (now - record.lastActivity <= timeout) continue;
      this.records.delete(key);
      try {
        record.agent.cancel({ kind: 'user' });
      } catch {
        // 忽略
      }
      record.handle.dispose().catch(() => {});
      this.logger.debug(`回收闲置会话 ${key}`);
    }
  }

  async disposeAll() {
    clearInterval(this.timer);
    await this.resetAll();
  }

  /** 释放全部会话（人设热重载后调用），但保留闲置回收定时器。 */
  async resetAll() {
    const records = [...this.records.values()];
    this.records.clear();
    await Promise.allSettled(
      records.map(async (record) => {
        try {
          record.agent.cancel({ kind: 'user' });
        } catch {
          // 忽略
        }
        await record.handle.dispose().catch(() => {});
      }),
    );
  }

  get size() {
    return this.records.size;
  }

  snapshot() {
    return [...this.records.values()].map((record) => ({
      peerKey: record.key,
      persona: record.persona.id,
      personaName: record.persona.name,
      messages: Array.isArray(record.agent.session?.events) ? record.agent.session.events.length : undefined,
      idleSec: Math.round((Date.now() - record.lastActivity) / 1000),
    }));
  }
}

export { deriveSessionId };
