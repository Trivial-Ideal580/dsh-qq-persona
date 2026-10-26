/**
 * 极简 YAML 输出器 —— 只为了把人设对象写回人类可读的 YAML。
 *
 * 输出范围与 src/util.js 里的解析器严格对应：
 *   映射 / 列表 / 行内数组 / 块文本 / 引号字符串 / 布尔 / 数字。
 * 写完后再解析回来能还原成同一个对象（测试里做了 round-trip）。
 */

const PAD = (level) => '  '.repeat(level);

const NEEDS_QUOTE_START = /^[\s\-:?,[\]{}#&*!|>'"%@`]/;
const NUMBER_LIKE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const BOOL_LIKE = /^(?:true|false|null|~|yes|no|on|off)$/i;

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function quoteScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  const text = String(value);
  if (text === '') return "''";
  const plain =
    !NEEDS_QUOTE_START.test(text) &&
    !/:\s/.test(text) &&
    !/\s#/.test(text) &&
    !/\s$/.test(text) &&
    !NUMBER_LIKE.test(text) &&
    !BOOL_LIKE.test(text) &&
    !text.includes(',') &&
    !text.includes('\n');
  return plain ? text : JSON.stringify(text);
}

function writeObject(object, level, out) {
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    writeEntry(key, value, level, out);
  }
}

function writeEntry(key, value, level, out) {
  const head = `${PAD(level)}${key}:`;

  if (isScalar(value)) {
    const text = value === null ? '' : String(value);
    if (typeof value === 'string' && text.includes('\n')) {
      out.push(`${head} |`);
      for (const line of text.replace(/\n+$/, '').split('\n')) {
        out.push(line ? `${PAD(level + 1)}${line}` : '');
      }
      return;
    }
    out.push(`${head} ${quoteScalar(value)}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${head} []`);
      return;
    }
    const inline =
      value.every(isScalar) &&
      value.every((item) => !String(item ?? '').includes('\n')) &&
      value.map(quoteScalar).join(', ').length < 78;
    if (inline) {
      out.push(`${head} [${value.map(quoteScalar).join(', ')}]`);
      return;
    }
    out.push(head);
    for (const item of value) {
      if (isScalar(item)) {
        out.push(`${PAD(level + 1)}- ${quoteScalar(item)}`);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const block = [];
        writeObject(item, level + 2, block);
        if (block.length === 0) {
          out.push(`${PAD(level + 1)}- {}`);
          continue;
        }
        // 把对象第一行的缩进换成 "- "（宽度相同：2*(L+1) === 2*L + 2）
        block[0] = `${PAD(level + 1)}- ${block[0].slice(PAD(level + 2).length)}`;
        out.push(...block);
      } else {
        out.push(`${PAD(level + 1)}- ${quoteScalar(String(item))}`);
      }
    }
    return;
  }

  // 嵌套对象
  const block = [];
  writeObject(value, level + 1, block);
  if (block.length === 0) {
    out.push(`${head} {}`);
    return;
  }
  out.push(head);
  out.push(...block);
}

/** 通用对象 → YAML 文本。 */
export function stringifyYaml(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('stringifyYaml 只接受普通对象');
  }
  const out = [];
  writeObject(value, 0, out);
  return `${out.join('\n')}\n`;
}

/** 去掉空字段，让写出来的人设文件保持干净。 */
export function compactPersona(persona) {
  const drop = (object) => {
    const out = {};
    for (const [key, value] of Object.entries(object)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === 'object' && !Array.isArray(value)) {
        const nested = drop(value);
        if (Object.keys(nested).length === 0) continue;
        out[key] = nested;
        continue;
      }
      out[key] = value;
    }
    return out;
  };
  return drop(persona);
}

/** 人设对象 → 人设 YAML 文件内容。 */
export function personaToYaml(persona) {
  const doc = {
    id: persona.id,
    name: persona.name,
    enabled: persona.enabled,
    identity: persona.identity,
    relationship: persona.relationship,
    background: persona.background,
    personality: persona.personality,
    personalityDetail: persona.personalityDetail,
    style: {
      tone: persona.style.tone,
      length: persona.style.length,
      sentence: persona.style.sentence,
      particles: persona.style.particles,
      catchphrases: persona.style.catchphrases,
      emojiRate: persona.style.emojiRate,
      punctuation: persona.style.punctuation,
      typos: persona.style.typos,
      avoid: persona.style.avoid,
    },
    taboos: persona.taboos,
    examples: persona.examples.map((example) => ({
      user: example.user,
      assistant: example.assistant.join('\n'),
    })),
    reply: {
      maxBubbles: persona.reply.maxBubbles,
      maxCharsPerBubble: persona.reply.maxCharsPerBubble,
    },
  };
  return `# 由 QQ 人设工作台生成 · 可以手改，改完在工作台点“重新加载”\n${stringifyYaml(compactPersona(doc))}`;
}
