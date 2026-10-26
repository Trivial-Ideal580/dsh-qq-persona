/**
 * 人设仓库：从 personas/ 目录读取 *.yaml / *.yml / *.json(c)，
 * 做默认值补全与校验，并提供「某人某群用哪个人设」的持久化覆盖。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseConfigText, errorText } from './util.js';

/** 人设默认值。写人设时只需要填想自定义的部分。 */
export const PERSONA_DEFAULTS = {
  enabled: true,
  identity: '',
  relationship: '',
  background: '',
  personality: [],
  personalityDetail: '',
  taboos: [],
  examples: [],
  style: {
    tone: '随意的口语，像平时发微信',
    length: 'short',
    sentence: '短句为主，一句一条',
    particles: [],
    catchphrases: [],
    emojiRate: 0.2,
    punctuation: '',
    typos: '',
    avoid: ['书面语', '长篇大论', '说教', '客服腔'],
  },
  reply: {
    maxBubbles: 2,
    maxCharsPerBubble: 40,
    splitBubbles: true,
  },
};

const MAX_CHARS_BY_LENGTH = { short: 40, medium: 80, long: 160 };
const PERSONA_EXTENSIONS = new Set(['.yaml', '.yml', '.json', '.jsonc']);

const asArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [String(value)];
};

const asText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const asNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/** 示例里的 assistant：可以是单条字符串、行内数组，或多行块文本（一行一条）。 */
function asBubbles(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((item) => String(item).split('\n'))
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 把示例里的 assistant 统一成数组（一个示例可以示范“连发两条”）。 */
function normalizeExamples(examples) {
  if (!Array.isArray(examples)) return [];
  return examples
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const user = asText(item.user ?? item.q ?? item.input);
      const assistant = asBubbles(item.assistant ?? item.a ?? item.reply ?? item.output);
      if (!user || assistant.length === 0) return null;
      return { user, assistant };
    })
    .filter(Boolean);
}

/** 补全默认值并校验，返回可直接使用的人设对象。 */
export function normalizePersona(raw, sourceName = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`人设 ${sourceName} 不是一个对象`);
  }
  const id = asText(raw.id) || basename(sourceName, extname(sourceName));
  const name = asText(raw.name ?? raw.昵称 ?? raw.id);
  if (!id) throw new Error(`人设 ${sourceName} 缺少 id`);
  if (!name) throw new Error(`人设 ${sourceName} 缺少 name`);

  const style = { ...PERSONA_DEFAULTS.style, ...(raw.style ?? {}) };
  const reply = { ...PERSONA_DEFAULTS.reply, ...(raw.reply ?? {}) };
  const length = ['short', 'medium', 'long'].includes(asText(style.length))
    ? asText(style.length)
    : 'short';

  return {
    id,
    name,
    enabled: raw.enabled !== false,
    identity: asText(raw.identity),
    relationship: asText(raw.relationship),
    background: asText(raw.background),
    personality: asArray(raw.personality),
    personalityDetail: asText(raw.personalityDetail),
    taboos: asArray(raw.taboos),
    examples: normalizeExamples(raw.examples),
    style: {
      tone: asText(style.tone) || PERSONA_DEFAULTS.style.tone,
      length,
      sentence: asText(style.sentence),
      particles: asArray(style.particles),
      catchphrases: asArray(style.catchphrases),
      emojiRate: Math.min(1, Math.max(0, asNumber(style.emojiRate, 0.2))),
      punctuation: asText(style.punctuation),
      typos: asText(style.typos),
      avoid: asArray(style.avoid),
    },
    reply: {
      maxBubbles: Math.min(5, Math.max(1, Math.round(asNumber(reply.maxBubbles, 2)))),
      maxCharsPerBubble:
        Math.round(asNumber(reply.maxCharsPerBubble, 0)) || MAX_CHARS_BY_LENGTH[length],
      splitBubbles: reply.splitBubbles !== false,
    },
    source: sourceName,
  };
}

/** 合并「全局风格覆盖」与「人设自身设置」，得出本次发送的实际参数。 */
export function resolveReplyStyle(persona, config) {
  const override = config?.style ?? {};
  const maxBubbles = override.maxBubbles > 0 ? override.maxBubbles : persona.reply.maxBubbles;
  const maxChars = override.maxCharsPerBubble > 0
    ? override.maxCharsPerBubble
    : persona.reply.maxCharsPerBubble;
  const emojiRate = override.emojiRate >= 0 ? override.emojiRate : persona.style.emojiRate;
  return {
    maxBubbles: Math.min(5, Math.max(1, Math.round(maxBubbles))),
    maxCharsPerBubble: Math.max(8, Math.round(maxChars)),
    emojiRate,
    splitBubbles: persona.reply.splitBubbles,
    typingBaseMs: Math.max(0, asNumber(override.typingBaseMs, 600)),
    typingPerCharMs: Math.max(0, asNumber(override.typingPerCharMs, 30)),
    maxTypingMs: Math.max(0, asNumber(override.maxTypingMs, 4000)),
    simulateTyping: override.simulateTyping !== false,
  };
}

/**
 * 人设仓库。
 *
 * 支持多个目录，后面的目录覆盖前面的同名 id：
 *   [插件自带 personas, 用户目录 ~/.dsh/qq-persona/personas]
 * 这样内置人设可以当模板，用户改出来的人设单独存放，重装插件也不会丢。
 */
export class PersonaStore {
  /**
   * @param {{dir?: string, dirs?: string[], logger: object}} options
   */
  constructor({ dir, dirs, logger }) {
    const list = dirs ?? (dir ? [dir] : []);
    this.dirs = list.map((item) => resolve(item));
    this.dir = this.dirs[0];
    this.logger = logger;
    /** @type {Map<string, ReturnType<typeof normalizePersona>>} */
    this.personas = new Map();
    /** @type {Map<string, string>} */
    this.files = new Map();
    this.errors = [];
  }

  /** 读取所有目录。失败的单个文件只记录错误，不影响其他文件。 */
  load() {
    this.personas.clear();
    this.files.clear();
    this.errors = [];

    for (const dir of this.dirs) {
      if (!existsSync(dir)) {
        this.logger?.debug?.(`人设目录不存在，跳过：${dir}`);
        continue;
      }
      const files = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && PERSONA_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .map((entry) => join(dir, entry.name))
        .sort();

      for (const file of files) {
        try {
          const raw = parseConfigText(readFileSync(file, 'utf8'), file);
          const persona = normalizePersona(raw, file);
          if (this.personas.has(persona.id)) {
            this.logger?.info?.(`人设 ${persona.id} 被 ${basename(file)} 覆盖`);
          }
          this.personas.set(persona.id, persona);
          this.files.set(persona.id, file);
          this.logger?.debug?.(`已加载人设 ${persona.id} (${persona.name}) ← ${file}`);
        } catch (error) {
          const message = `${basename(file)}: ${errorText(error)}`;
          this.errors.push(message);
          this.logger?.error?.(`人设加载失败 ${message}`);
        }
      }
    }

    if (this.personas.size === 0) {
      throw new Error(`没有可用人设（${this.dirs.join('、')}）`);
    }
    return this;
  }

  fileOf(id) {
    return this.files.get(id);
  }

  list() {
    return [...this.personas.values()];
  }

  get(id) {
    return this.personas.get(id);
  }

  /** 按 id 找人设；找不到就回退到第一个人设，并给出提示。 */
  resolve(id) {
    if (id && this.personas.has(id)) return this.personas.get(id);
    const fallback = this.personas.values().next().value;
    if (!fallback) throw new Error('没有任何人设');
    if (id) this.logger?.warn?.(`人设 "${id}" 不存在，回退到 "${fallback.id}"`);
    return fallback;
  }

  get size() {
    return this.personas.size;
  }
}

/**
 * 每个「私聊对象 / 群」的人设覆盖，落盘为 JSON，重启后仍生效。
 */
export class PersonaOverrides {
  constructor(file, logger) {
    this.file = resolve(file);
    this.logger = logger;
    /** @type {Record<string, string>} */
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (!existsSync(this.file)) return;
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') this.data = parsed;
    } catch (error) {
      this.logger?.warn?.(`人设覆盖文件读取失败：${errorText(error)}`);
    }
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    } catch (error) {
      this.logger?.warn?.(`人设覆盖文件写入失败：${errorText(error)}`);
    }
  }

  get(peerKey) {
    return this.data[peerKey];
  }

  set(peerKey, personaId) {
    this.data[peerKey] = personaId;
    this.save();
  }

  clear(peerKey) {
    delete this.data[peerKey];
    this.save();
  }
}
