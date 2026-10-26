/**
 * 拟人化输出管线。
 *
 * 模型总会不自觉地输出 Markdown、括号动作、解释性前缀、超长段落。
 * 这些在 QQ 聊天里一眼假，所以发送前统一洗一遍：
 *
 *   sanitize → splitBubbles → emoji 策略 → 打字延迟
 */

const SPEAKER_PREFIX = /^\s*(?:你|我|AI|ai|助手|机器人|assistant|bot|Bot)\s*[：:]\s*/;
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
const EMOJI_TEST = /\p{Extended_Pictographic}/u;

/** 去掉 Markdown / 前后缀 / 括号动作，保留纯聊天文字。 */
export function sanitizeReply(input) {
  let text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  // 整段代码块直接丢掉（模型偶尔会“展示”一段代码）
  text = text.replace(/```[\s\S]*?```/g, ' ');

  // 行内代码、加粗、斜体、标题、引用、列表符号
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/https?:\/\/\S+/g, '');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+)\*(?![\w*])/g, '$1');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, '');

  // 括号里的动作/心理描写：（笑）（沉默了一会儿）(sighs)
  // 纯数字/符号的括号（如 (1)、(2024)）保留，那是正常内容
  text = text.replace(/[（(]([^（）()\n]{0,24})[）)]/g, (all, inner) =>
    /^[\d\s.+\-*/=%,:：]+$/.test(inner) ? all : ' ',
  );

  // 统一成按行
  const lines = text
    .split('\n')
    .map((line) => line.replace(/<@!?[^>]*>/g, ''))
    .map((line) => line.replace(SPEAKER_PREFIX, '').trim())
    // 模型偶尔会写“@张三 在的”这种开头；群里默认不 @ 人，直接抹掉
    .map((line) => line.replace(/^@[^\s,，。!！?？:：]{1,24}\s*/, ''))
    .map((line) => line.replace(/\s{2,}/g, ' '))
    .filter(Boolean);

  // 整段被一对引号包住时去掉引号
  return lines
    .map((line) => {
      const match = /^["“''](.+)["”'']$/.exec(line);
      return match ? match[1].trim() : line;
    })
    .join('\n')
    .trim();
}

/** 按句末标点切句。 */
function splitSentences(line) {
  const parts = line.match(/[^。！？!?…~～]+[。！？!?…~～]*/g) ?? [line];
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** 按码点截断（避免把 emoji 从中间切开）。 */
function truncate(text, maxChars) {
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join('').replace(/[，,、\s]+$/, '');
}

/**
 * 把一段回复切成 1~N 条消息，模拟真人连发。
 * @param {string} text sanitize 之后的文本
 * @param {{maxBubbles: number, maxCharsPerBubble: number, splitBubbles?: boolean}} style
 * @returns {string[]}
 */
export function splitBubbles(text, style) {
  const maxBubbles = Math.max(1, style.maxBubbles ?? 2);
  const maxChars = Math.max(8, style.maxCharsPerBubble ?? 40);
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return [];
  if (style.splitBubbles === false) return [truncate(trimmed, maxChars * maxBubbles)];

  const units = [];
  for (const line of trimmed.split('\n')) {
    const clean = line.trim();
    if (!clean) continue;
    if ([...clean].length <= maxChars) {
      units.push(clean);
    } else {
      units.push(...splitSentences(clean));
    }
  }
  if (units.length === 0) return [];

  let bubbles;
  if (units.length <= maxBubbles) {
    bubbles = units;
  } else {
    // 把句子按累计字数均分到 maxBubbles 条里
    const total = units.reduce((sum, unit) => sum + [...unit].length, 0);
    const target = Math.ceil(total / maxBubbles);
    bubbles = [];
    let current = '';
    for (const unit of units) {
      if (current && [...current].length + [...unit].length > target && bubbles.length < maxBubbles - 1) {
        bubbles.push(current);
        current = unit;
      } else {
        current = current ? `${current} ${unit}` : unit;
      }
    }
    if (current) bubbles.push(current);
  }

  // 合并空项、限制条数、硬截断
  return bubbles
    .map((bubble) => bubble.trim())
    .filter(Boolean)
    .slice(0, maxBubbles)
    .map((bubble) => truncate(bubble, maxChars));
}

/** 数一条消息里有几个 emoji。 */
export function countEmoji(text) {
  return (String(text).match(EMOJI) ?? []).length;
}

/** 按人设的 emoji 频率决定保留还是抹掉。 */
export function applyEmojiPolicy(bubbles, rate, random = Math.random) {
  const probability = Math.min(1, Math.max(0, rate ?? 0));
  return bubbles.map((bubble) => {
    if (!EMOJI_TEST.test(bubble)) return bubble;
    // 频率极低：全部去掉
    if (probability <= 0.02) return bubble.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
    // 超出频率或一条里堆了太多：去掉
    const count = countEmoji(bubble);
    if (count > 2 || random() > probability) {
      return bubble.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
    }
    return bubble;
  });
}

/**
 * 完整渲染：清洗 → 分条 → emoji 策略。
 * @returns {string[]} 真正要按顺序发出去的消息
 */
export function renderReply(text, style, random = Math.random) {
  const sanitized = sanitizeReply(text);
  if (!sanitized) return [];
  const bubbles = splitBubbles(sanitized, style);
  return applyEmojiPolicy(bubbles, style.emojiRate, random)
    .map((bubble) => bubble.trim())
    .filter(Boolean);
}

/** 一条消息的“打字”延迟：基础 + 每字，带一点随机抖动，封顶。 */
export function typingDelayMs(text, style, random = Math.random) {
  if (style.simulateTyping === false) return 0;
  const length = [...String(text ?? '')].length;
  const base = (style.typingBaseMs ?? 600) + length * (style.typingPerCharMs ?? 30);
  const jittered = base * (0.7 + random() * 0.6);
  return Math.round(Math.min(style.maxTypingMs ?? 4000, Math.max(120, jittered)));
}
