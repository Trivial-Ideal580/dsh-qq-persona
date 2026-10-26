/**
 * 群聊滚动上下文。
 *
 * 群里所有消息都会进这个缓冲（不只是 @ 它的那条）；等它真的要接话时，
 * 把「上次开口之后群里发生的事」一次性交给模型。接完就清空，
 * 所以下一轮拿到的是“它没看见的那段聊天”，不会重复、也不会漏。
 */

const MAX_PEERS = 500;
const DEFAULTS = { limit: 20, ttlMs: 30 * 60 * 1000 };

export class GroupHistory {
  constructor({ limit, ttlMs, logger } = {}) {
    this.limit = Math.max(1, Number(limit) || DEFAULTS.limit);
    this.ttlMs = Math.max(60_000, Number(ttlMs) || DEFAULTS.ttlMs);
    this.logger = logger;
    /** @type {Map<string, {name: string, text: string, ts: number, messageId?: string}[]>} */
    this.buffers = new Map();
  }

  buffer(peerKey) {
    let list = this.buffers.get(peerKey);
    if (!list) {
      list = [];
      this.buffers.set(peerKey, list);
      if (this.buffers.size > MAX_PEERS) {
        const oldest = this.buffers.keys().next().value;
        this.buffers.delete(oldest);
      }
    }
    return list;
  }

  /** 记录一条群消息（不触发回复的也要记）。 */
  append(peerKey, entry) {
    if (!entry?.text) return;
    const list = this.buffer(peerKey);
    const last = list[list.length - 1];
    // 同一条消息重复投递时跳过
    if (entry.messageId && last?.messageId === entry.messageId) return;
    list.push({
      name: entry.name || '群友',
      text: String(entry.text).trim().slice(0, 500),
      ts: Date.now(),
      messageId: entry.messageId,
    });
    this.trim(list);
  }

  trim(list) {
    const cutoff = Date.now() - this.ttlMs;
    while (list.length > 0 && (list.length > this.limit || list[0].ts < cutoff)) {
      list.shift();
    }
  }

  /** 取出并清空——它已经看过这段了。 */
  take(peerKey) {
    const list = this.buffers.get(peerKey);
    if (!list) return [];
    this.buffers.delete(peerKey);
    this.trim(list);
    return list;
  }

  peek(peerKey) {
    const list = this.buffers.get(peerKey);
    if (!list) return [];
    this.trim(list);
    return [...list];
  }

  clear() {
    this.buffers.clear();
  }

  get size() {
    return this.buffers.size;
  }
}

/** 把群消息压成一行，供历史缓冲使用（不调用视觉模型，避免为每条消息花钱）。 */
export function summarizeForHistory(msg) {
  const text = String(msg?.content ?? '')
    .replace(/<@[^>]*>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
  const counts = { image: 0, voice: 0, file: 0, video: 0 };
  for (const item of attachments) {
    const type = String(item?.content_type ?? '').toLowerCase();
    if (type.startsWith('image')) counts.image += 1;
    else if (type.startsWith('voice') || type.startsWith('audio')) counts.voice += 1;
    else if (type.startsWith('video')) counts.video += 1;
    else counts.file += 1;
  }
  const tags = [
    counts.image ? `[图片×${counts.image}]` : '',
    counts.voice ? `[语音×${counts.voice}]` : '',
    counts.video ? `[视频×${counts.video}]` : '',
    counts.file ? `[文件×${counts.file}]` : '',
  ].filter(Boolean);
  const merged = [text, ...tags].filter(Boolean).join(' ');
  return merged || '';
}

/** 把缓冲渲染成给模型看的上下文块。 */
export function formatHistoryBlock(entries) {
  if (!entries || entries.length === 0) return '';
  const lines = entries.map((entry) => `${entry.name}：${entry.text}`);
  return `[群里刚才的消息]\n${lines.join('\n')}\n[当前消息]`;
}
