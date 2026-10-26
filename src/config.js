/**
 * 插件配置 Schema。
 *
 * 这些字段会直接出现在 DeepSeek Harness 的「设置 → 插件」面板里，
 * 改完保存即热更新，不需要碰代码。
 *
 * 关于「0 / -1 表示跟随人设」：人设文件里可以给每个人单独设说话习惯，
 * 这里留 0 或 -1 就不覆盖它；填正数则全局强制。
 */
import Schema from '@deepseek-ai/schemastery';

export const ConfigSchema = Schema.object({
  // ── 凭据 ──────────────────────────────────────────────
  appId: Schema.string()
    .default('')
    .description('QQ 机器人 AppID（留空则读环境变量 QQBOT_APPID）'),
  appSecret: Schema.string()
    .default('')
    .description('QQ 机器人 AppSecret（留空则读环境变量 QQBOT_SECRET）'),

  // ── 模型 ──────────────────────────────────────────────
  provider: Schema.string().description('模型提供方；留空沿用 DSH 默认模型'),
  model: Schema.string().description('模型名；留空沿用 DSH 默认模型'),
  cwd: Schema.string().description('Agent 工作目录；留空用进程目录'),

  // ── 人设 ──────────────────────────────────────────────
  personaId: Schema.string()
    .default('linfi')
    .description('默认人设 id（对应 personas/<id>.yaml）'),
  personasDir: Schema.string()
    .default('')
    .description('人设目录；留空用插件自带的 personas/'),
  toolsEnabled: Schema.boolean()
    .default(false)
    .description('是否允许模型使用工具。人设聊天建议关闭：群里任何人都可能诱导它执行命令'),

  // ── 说话风格（全局覆盖）──────────────────────────────
  style: Schema.object({
    maxBubbles: Schema.number().default(0).description('每次最多发几条消息；0 = 跟随人设'),
    maxCharsPerBubble: Schema.number().default(0).description('单条最多多少字；0 = 跟随人设'),
    emojiRate: Schema.number().default(-1).description('带 emoji 的消息比例 0~1；-1 = 跟随人设'),
    typingBaseMs: Schema.number().default(600).description('发出前的基础停顿(ms)'),
    typingPerCharMs: Schema.number().default(30).description('每字追加的“打字”时间(ms)'),
    maxTypingMs: Schema.number().default(4000).description('停顿上限(ms)'),
    simulateTyping: Schema.boolean().default(true).description('是否模拟真人打字停顿'),
  })
    .default({
      maxBubbles: 0,
      maxCharsPerBubble: 0,
      emojiRate: -1,
      typingBaseMs: 600,
      typingPerCharMs: 30,
      maxTypingMs: 4000,
      simulateTyping: true,
    })
    .description('说话风格全局覆盖'),

  // ── 什么时候接话 ─────────────────────────────────────
  trigger: Schema.object({
    requireMention: Schema.boolean()
      .default(true)
      .description('群聊里必须 @ 它才回复；关闭后会按下面规则主动接话'),
    keywords: Schema.array(Schema.string())
      .default([])
      .description('命中这些词也会接话（例如 ["林绯","小夏"]）'),
    randomChance: Schema.number()
      .default(0)
      .description('群聊里随机插话的概率 0~1，0 表示不随机插话'),
    cooldownSec: Schema.number().default(20).description('同一个群两次回复的最小间隔(秒)'),
    activeWindowMin: Schema.number()
      .default(30)
      .description('群聊闲置超过多少分钟后不再随机插话'),
    historyLimit: Schema.number()
      .default(20)
      .description('群聊上下文最多记多少条（不只 @ 它的消息）'),
    historyTtlMin: Schema.number().default(30).description('群聊上下文保留多少分钟'),
  })
    .default({
      requireMention: true,
      keywords: [],
      randomChance: 0,
      cooldownSec: 20,
      activeWindowMin: 30,
      historyLimit: 20,
      historyTtlMin: 30,
    })
    .description('接话策略'),

  // ── 访问控制 ─────────────────────────────────────────
  access: Schema.object({
    c2cMode: Schema.union(['open', 'allowlist', 'disabled'])
      .default('open')
      .description('私聊模式'),
    c2cAllow: Schema.array(Schema.string()).default([]).description('私聊白名单（openid）'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled'])
      .default('open')
      .description('群聊模式'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（群 openid）'),
  })
    .default({ c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [] })
    .description('谁可以和它聊天'),

  // ── 管理指令 ─────────────────────────────────────────
  commands: Schema.object({
    enabled: Schema.boolean().default(true).description('是否启用 /persona 等指令'),
    admins: Schema.array(Schema.string())
      .default([])
      .description('允许在群里执行管理指令的用户 openid；留空则只有私聊能用'),
  })
    .default({ enabled: true, admins: [] })
    .description('斜杠指令'),

  // ── 多模态 ──────────────────────────────────────────
  vision: Schema.object({
    enabled: Schema.boolean().default(true).description('是否让视觉模型描述收到的图片'),
    baseUrl: Schema.string()
      .default('https://api.openai.com/v1')
      .description('OpenAI 兼容的视觉模型地址'),
    apiKey: Schema.string().default('').description('视觉模型 API Key（也可用环境变量 VISION_API_KEY）'),
    model: Schema.string().default('gpt-4o-mini').description('视觉模型名，例如 gpt-4o-mini / Qwen/Qwen2.5-VL-7B-Instruct'),
    prompt: Schema.string().default('').description('看图时给模型的指令；留空用默认'),
    maxChars: Schema.number().default(300).description('图片描述最多保留多少字'),
    timeoutMs: Schema.number().default(20000).description('视觉请求超时(ms)'),
    maxImageBytes: Schema.number().default(8000000).description('超过这个大小的图片不下载'),
  })
    .default({
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      prompt: '',
      maxChars: 300,
      timeoutMs: 20000,
      maxImageBytes: 8000000,
    })
    .description('图片识别（可选）'),
  media: Schema.object({
    readTextFiles: Schema.boolean().default(true).description('文本类文件是否直接读取内容'),
    maxTextFileBytes: Schema.number().default(65536).description('读取文本文件的最大字节数'),
  })
    .default({ readTextFiles: true, maxTextFileBytes: 65536 })
    .description('文件/语音处理'),

  // ── 画图 ────────────────────────────────────────────
  imagegen: Schema.object({
    enabled: Schema.boolean().default(true).description('是否允许它发图片'),
    baseUrl: Schema.string()
      .default('https://api.openai.com/v1')
      .description('OpenAI 兼容的图片生成地址'),
    apiKey: Schema.string().default('').description('画图 API Key（也可用环境变量 IMAGE_API_KEY）'),
    model: Schema.string().default('gpt-image-1').description('图片模型，例如 gpt-image-1 / dall-e-3 / FLUX.1-schnell'),
    size: Schema.string().default('1024x1024').description('图片尺寸'),
    timeoutMs: Schema.number().default(90000).description('画图超时(ms)'),
    maxPerTurn: Schema.number().default(1).description('每轮最多生成几张'),
  })
    .default({
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-image-1',
      size: '1024x1024',
      timeoutMs: 90000,
      maxPerTurn: 1,
    })
    .description('AI 画图（可选）'),
  groupReplyMode: Schema.union(['auto', 'active', 'passive'])
    .default('auto')
    .description('群聊回复方式：auto=先试不引用原消息（失败自动回退），passive=总是引用回复'),
  onImageError: Schema.string()
    .default('画图失败了，等会儿再试')
    .description('画图失败时回的话；留空则沉默'),

  // ── 运行参数 ─────────────────────────────────────────
  onErrorReply: Schema.string()
    .default('……刚才卡了一下，你再说一遍？')
    .description('本轮生成失败时回给对方的兜底话；留空表示失败就沉默'),
  sessionIdleTimeout: Schema.number()
    .default(30 * 60 * 1000)
    .description('会话闲置多久后回收(ms)'),
  maxQueue: Schema.number().default(20).description('同一个人/群的消息排队上限'),
  processingTimeoutMs: Schema.number().default(120000).description('单次处理超时(ms)'),
  autoQrSetup: Schema.boolean()
    .default(true)
    .description('缺少 AppID/AppSecret 时是否尝试终端扫码绑定'),
  debug: Schema.boolean().default(false).description('调试日志'),
});

export default ConfigSchema;
