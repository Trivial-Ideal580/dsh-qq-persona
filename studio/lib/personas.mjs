/**
 * 工作台的人设服务：读取内置 + 用户人设，保存时写进用户目录。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizePersona, PersonaStore, resolveReplyStyle } from '../../src/persona.js';
import { buildSystemPrompt } from '../../src/prompt.js';
import { personaToYaml } from '../../src/yaml-write.js';

const ID_MAX = 40;
const ID_FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

/** 把名字变成一个能当文件名、也能在 /persona use 里打出来的 id。 */
export function deriveId(name) {
  const cleaned = String(name ?? '')
    .trim()
    .replace(ID_FORBIDDEN, '')
    .replace(/\s+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, ID_MAX);
  return cleaned || `persona-${Date.now().toString(36)}`;
}

function validateId(raw) {
  const id = String(raw ?? '').trim();
  if (!id) throw new Error('id 不能为空');
  if (id.length > ID_MAX) throw new Error(`id 最多 ${ID_MAX} 个字符`);
  if (ID_FORBIDDEN.test(id)) throw new Error('id 不能包含 \\ / : * ? " < > | 这些字符');
  if (id.startsWith('.')) throw new Error('id 不能以点开头');
  return id;
}

export function emptyPersona() {
  return {
    id: '',
    name: '',
    enabled: true,
    identity: '',
    relationship: '',
    background: '',
    personality: [],
    personalityDetail: '',
    style: {
      tone: '随手的口语，像平时发微信',
      length: 'short',
      sentence: '短句为主，一句一条',
      particles: [],
      catchphrases: [],
      emojiRate: 0.2,
      punctuation: '',
      typos: '',
      avoid: ['书面语', '长篇大论', '说教', '客服腔'],
    },
    taboos: [],
    examples: [],
    reply: { maxBubbles: 2, maxCharsPerBubble: 40 },
  };
}

export class PersonaService {
  constructor({ builtinDir, userDir, logger }) {
    this.builtinDir = resolve(builtinDir);
    this.userDir = resolve(userDir);
    this.logger = logger;
    this.store = new PersonaStore({ dirs: [this.builtinDir, this.userDir], logger });
    this.reload();
  }

  reload() {
    this.store.load();
    return this;
  }

  fileOf(id) {
    return this.store.fileOf(id);
  }

  isUserFile(file) {
    if (!file) return false;
    return resolve(file).startsWith(`${this.userDir}${sep}`);
  }

  list() {
    return this.store.list().map((persona) => {
      const file = this.fileOf(persona.id);
      return {
        id: persona.id,
        name: persona.name,
        identity: persona.identity,
        personality: persona.personality,
        emojiRate: persona.style.emojiRate,
        maxBubbles: persona.reply.maxBubbles,
        file,
        builtin: Boolean(file) && !this.isUserFile(file),
        editable: !file || this.isUserFile(file),
      };
    });
  }

  get(id) {
    const persona = this.store.get(id);
    if (!persona) throw new Error(`没有这个人生：「${id}」`);
    return persona;
  }

  /** 校验 + 补默认值，不落盘。id 留空时用名字推导。 */
  normalize(input) {
    const given = String(input?.id ?? '').trim();
    const id = validateId(given || deriveId(input?.name));
    return normalizePersona({ ...input, id }, `${id}.yaml`);
  }

  save(input) {
    const persona = this.normalize(input);
    mkdirSync(this.userDir, { recursive: true });
    const file = join(this.userDir, `${persona.id}.yaml`);
    writeFileSync(file, personaToYaml(persona), 'utf8');
    this.reload();
    return { persona, file, editable: true };
  }

  /** 新建：id 可以留空（用名字），但不能和已有的人设撞 id。 */
  create(input) {
    const persona = this.normalize(input);
    if (this.store.get(persona.id)) {
      throw new Error(`已经有一个叫「${persona.id}」的人设了，换个名字或手填一个 id`);
    }
    return this.save(persona);
  }

  remove(id) {
    const file = this.fileOf(id);
    if (!file) throw new Error(`没有这个人生：「${id}」`);
    if (!this.isUserFile(file)) {
      throw new Error('这是插件自带的人设，不能删除。可以改名另存一份，或在它基础上直接保存（会生成一份可编辑副本）。');
    }
    unlinkSync(file);
    this.reload();
    return { ok: true };
  }

  duplicate(id, { id: newId, name } = {}) {
    const source = this.get(id);
    const targetId = validateId(String(newId ?? '').trim() || `${source.id}-copy`);
    if (this.store.get(targetId)) throw new Error(`id「${targetId}」已经被占用了`);
    const copy = {
      ...JSON.parse(JSON.stringify(source)),
      id: targetId,
      name: name || `${source.name} 副本`,
    };
    return this.save(copy);
  }

  /** 生成 system prompt 预览。 */
  preview(input, scene = {}) {
    const persona = this.normalize(input);
    const replyStyle = resolveReplyStyle(persona, { style: {} });
    return {
      prompt: buildSystemPrompt(persona, {
        scope: scene.scope === 'c2c' ? 'c2c' : 'group',
        groupName: scene.groupName || '摸鱼群',
        peerName: scene.peerName || '阿伟',
        replyStyle,
      }),
      replyStyle,
    };
  }

  /** 工作台里“导出/查看 YAML”用。 */
  toYaml(input) {
    return personaToYaml(this.normalize(input));
  }

  readRaw(id) {
    const file = this.fileOf(id);
    if (!file || !existsSync(file)) return '';
    return readFileSync(file, 'utf8');
  }
}
