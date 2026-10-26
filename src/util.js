/**
 * 小工具集合：零依赖 YAML 子集解析、JSONC、时间/随机数、路径。
 *
 * 人设文件是给人手写的，所以用 YAML。为了不引入第三方依赖（插件装在
 * 受限的 profile 里，多一个依赖就多一次装不上的风险），这里实现一个
 * 覆盖人设文件所需语法的小解析器：
 *
 *   - 映射        key: value
 *   - 嵌套        缩进（2 空格或任意一致缩进）
 *   - 列表        - item / - key: value
 *   - 块文本      key: |   （保留换行）
 *                 key: >   （折行成空格）
 *   - 行内数组    [a, b, c]
 *   - 引号字符串  "..." / '...'
 *   - 注释        # 行尾注释、整行注释
 *   - 标量        true / false / null / 数字 / 字符串
 *
 * 不支持锚点、多文档、复杂 flow 语法 —— 人设文件也用不到。
 */

import { createHash } from 'node:crypto';

/** 解析一行里的 `#` 注释，字符串里的 # 不处理。 */
export function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** 把 `key: value` 拆开（冒号必须在引号外，且后面是空白或行尾）。 */
export function splitKeyValue(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return { key: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function unquote(text) {
  const quote = text[0];
  const body = text.slice(1, -1);
  if (quote === "'") return body.replace(/''/g, "'");
  return body.replace(/\\(["\\/nrt])/g, (_all, ch) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return ch;
    }
  });
}

/** 拆行内数组 [a, b, "c, d"]。 */
function splitInlineList(body) {
  const items = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += body[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current);
  return items;
}

/** 解析一个标量。 */
export function parseScalar(input) {
  const text = String(input).trim();
  if (text === '') return null;
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    return unquote(text);
  }
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitInlineList(text.slice(1, -1)).map((item) => parseScalar(item));
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?(?:\d+\.\d*|\.\d+)$/.test(text)) return Number(text);
  return text;
}

/**
 * 解析 YAML 子集。
 * @param {string} source
 * @returns {unknown}
 */
export function parseYaml(source) {
  const text = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rawLines = text.split('\n');

  /** @type {{raw: string, text: string, indent: number, lineNo: number}[]} */
  const lines = rawLines.map((raw, index) => {
    const cleaned = stripComment(raw);
    const trimmed = cleaned.trim();
    const indent = cleaned.length - cleaned.replace(/^ +/, '').length;
    return { raw: cleaned, text: trimmed, indent, lineNo: index + 1 };
  });

  let pos = 0;

  const peek = () => (pos < lines.length ? lines[pos] : undefined);
  const skipBlank = () => {
    while (pos < lines.length && lines[pos].text === '') pos += 1;
  };
  const peekContent = () => {
    let index = pos;
    while (index < lines.length && lines[index].text === '') index += 1;
    return index < lines.length ? lines[index] : undefined;
  };
  const fail = (line, message) => {
    throw new SyntaxError(`YAML 第 ${line?.lineNo ?? '?'} 行：${message}`);
  };

  function parseNode() {
    skipBlank();
    const line = peek();
    if (!line) return null;
    if (line.text === '-' || line.text.startsWith('- ')) return parseSequence(line.indent);
    if (!splitKeyValue(line.text)) fail(line, `无法解析 "${line.text}"（应为 key: value 或 - item）`);
    return parseMapping(line.indent);
  }

  function parseMapping(indent, target = {}) {
    for (;;) {
      skipBlank();
      const line = peek();
      if (!line || line.indent !== indent) break;
      if (line.text === '-' || line.text.startsWith('- ')) break;
      const kv = splitKeyValue(line.text);
      if (!kv) fail(line, `无法解析 "${line.text}"`);
      pos += 1;
      if (kv.value === '') {
        const next = peekContent();
        target[kv.key] = next && next.indent > indent ? parseNode() : null;
      } else if (/^[|>][+-]?$/.test(kv.value)) {
        target[kv.key] = parseBlockScalar(indent, kv.value);
      } else {
        target[kv.key] = parseScalar(kv.value);
      }
    }
    return target;
  }

  function parseSequence(indent) {
    const out = [];
    for (;;) {
      skipBlank();
      const line = peek();
      if (!line || line.indent !== indent) break;
      if (line.text !== '-' && !line.text.startsWith('- ')) break;
      const rest = line.text === '-' ? '' : line.text.slice(2).trim();
      if (rest === '') {
        pos += 1;
        const next = peekContent();
        out.push(next && next.indent > indent ? parseNode() : null);
        continue;
      }
      if (splitKeyValue(rest)) {
        // "- key: value" 等价于把这一行变成 indent+2 的映射首行
        const mapIndent = indent + 2;
        lines[pos] = { raw: ' '.repeat(mapIndent) + rest, text: rest, indent: mapIndent, lineNo: line.lineNo };
        out.push(parseMapping(mapIndent));
        continue;
      }
      pos += 1;
      out.push(parseScalar(rest));
    }
    return out;
  }

  function parseBlockScalar(parentIndent, marker) {
    const collected = [];
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.text === '') {
        collected.push('');
        pos += 1;
        continue;
      }
      if (line.indent <= parentIndent) break;
      collected.push(line.raw);
      pos += 1;
    }
    while (collected.length > 0 && collected[collected.length - 1].trim() === '') collected.pop();
    const nonEmpty = collected.filter((line) => line.trim() !== '');
    const minIndent = nonEmpty.reduce(
      (min, line) => Math.min(min, line.length - line.replace(/^ +/, '').length),
      Number.POSITIVE_INFINITY,
    );
    const dedented = collected.map((line) => (line.trim() === '' ? '' : line.slice(minIndent)));
    if (marker.startsWith('>')) {
      const paragraphs = [];
      let buffer = [];
      for (const line of dedented) {
        if (line.trim() === '') {
          if (buffer.length > 0) {
            paragraphs.push(buffer.join(' '));
            buffer = [];
          }
        } else {
          buffer.push(line.trim());
        }
      }
      if (buffer.length > 0) paragraphs.push(buffer.join(' '));
      return paragraphs.join('\n\n');
    }
    return dedented.join('\n').replace(/\s+$/, '');
  }

  const result = parseNode();
  skipBlank();
  if (pos < lines.length) fail(lines[pos], `缩进不合法或存在多余内容 "${lines[pos].text}"`);
  return result;
}

/** 去掉 JSON 注释与尾逗号后再解析。 */
export function parseJsonc(source) {
  const text = String(source);
  let out = '';
  let quote = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') {
      quote = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  // 去尾逗号（字符串外）
  let cleaned = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (inString) {
      cleaned += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    cleaned += ch;
  }
  return JSON.parse(cleaned);
}

/** 读取人设文件（按扩展名选择解析器）。 */
export function parseConfigText(text, file = '') {
  const lower = file.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.jsonc')) return parseJsonc(text);
  return parseYaml(text);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** [min, max) 区间随机小数。 */
export const randomBetween = (min, max) => min + Math.random() * (max - min);

/** 稳定、与人设无关的会话 key 派生（用于 sessionId）。 */
export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** 把任意异常转成一行可读文本。 */
export function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 日志：始终写 stdout/stderr。
 *
 * 这一点很关键：headless profile（没有 web/tui 前端）里的 ctx.logger 是静默的，
 * 如果只走 ctx.logger，工作台会永远看不到“启动失败”的原因，只能干等上线。
 * 所以这里固定走 console —— 工作台把子进程输出重定向到 bot.log 再读。
 */
export function createLogger(base) {
  const write = (level, message) => {
    const text = `[im-qq-persona] ${message}`;
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else if (level === 'debug') {
      if (process.env.IM_QQ_PERSONA_DEBUG === '1') console.log(text);
    } else console.log(text);
  };
  // 若宿主 logger 真的可用（web/tui 场景），顺带转发一份；headless 下它通常是空实现。
  const forward = (level, message) => {
    try {
      const fn = base?.[level];
      if (typeof fn === 'function' && base !== console) fn.call(base, `[im-qq-persona] ${message}`);
    } catch {
      // 忽略
    }
  };
  return {
    debug: (message) => write('debug', message),
    info: (message) => {
      write('info', message);
      forward('info', message);
    },
    warn: (message) => {
      write('warn', message);
      forward('warn', message);
    },
    error: (message) => {
      write('error', message);
      forward('error', message);
    },
  };
}
