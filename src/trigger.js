/**
 * 接话策略：决定一条群消息要不要回。
 *
 * 优先级：
 *   1. 被 @                    → 一定回
 *   2. 命中唤醒词               → 一定回
 *   3. 冷却中                   → 不回
 *   4. requireMention = false  → 回（“接管群聊”模式，受冷却约束）
 *   5. 随机插话命中             → 回
 *   6. 其他                     → 不回
 */

const MAX_PEERS = 4000;

export class TriggerPolicy {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    /** @type {Map<string, {lastReplyAt: number, lastHumanAt: number, lastReason: string}>} */
    this.peers = new Map();
  }

  update(config) {
    this.config = config;
  }

  state(peerKey) {
    let state = this.peers.get(peerKey);
    if (!state) {
      state = { lastReplyAt: 0, lastHumanAt: 0, lastReason: '' };
      this.peers.set(peerKey, state);
      if (this.peers.size > MAX_PEERS) {
        const oldest = this.peers.keys().next().value;
        this.peers.delete(oldest);
      }
    }
    return state;
  }

  noteHuman(peerKey) {
    this.state(peerKey).lastHumanAt = Date.now();
  }

  noteReply(peerKey, reason = '') {
    const state = this.state(peerKey);
    state.lastReplyAt = Date.now();
    state.lastReason = reason;
  }

  /**
   * @param {{scope: 'c2c'|'group', peerKey: string, text: string, wasMentioned: boolean}} input
   * @returns {{reply: boolean, reason: string}}
   */
  decide({ scope, peerKey, text, wasMentioned }) {
    if (scope !== 'group') return { reply: true, reason: 'private' };

    const trigger = this.config.trigger ?? {};
    const state = this.state(peerKey);
    const now = Date.now();

    if (wasMentioned) return { reply: true, reason: 'mention' };

    const keywords = (trigger.keywords ?? []).filter(Boolean);
    if (keywords.length > 0) {
      const hit = keywords.find((word) => String(text).includes(word));
      if (hit) return { reply: true, reason: `keyword:${hit}` };
    }

    const cooldownMs = Math.max(0, trigger.cooldownSec ?? 20) * 1000;
    if (cooldownMs > 0 && now - state.lastReplyAt < cooldownMs) {
      return { reply: false, reason: 'cooldown' };
    }

    if (trigger.requireMention === false) {
      return { reply: true, reason: 'all-messages' };
    }

    const chance = Math.min(1, Math.max(0, trigger.randomChance ?? 0));
    if (chance > 0) {
      const windowMs = Math.max(1, trigger.activeWindowMin ?? 30) * 60_000;
      const active = state.lastHumanAt > 0 && now - state.lastHumanAt <= windowMs;
      if (active && Math.random() < chance) return { reply: true, reason: 'random' };
    }

    return { reply: false, reason: 'silent' };
  }

  /** 给 /status 指令看的一眼状态。 */
  snapshot() {
    const now = Date.now();
    return [...this.peers.entries()]
      .filter(([, state]) => state.lastReplyAt > 0 || state.lastHumanAt > 0)
      .map(([peerKey, state]) => ({
        peerKey,
        lastHumanSecAgo: state.lastHumanAt ? Math.round((now - state.lastHumanAt) / 1000) : null,
        lastReplySecAgo: state.lastReplyAt ? Math.round((now - state.lastReplyAt) / 1000) : null,
        lastReason: state.lastReason,
      }));
  }

  get size() {
    return this.peers.size;
  }
}
