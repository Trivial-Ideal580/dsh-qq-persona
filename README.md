# dsh-qq-persona

> 让 AI 以你设定的人设、性格和说话风格，接管一个 QQ 机器人的聊天。
> 它不是"接了个大模型的客服"，而是尽量像一个具体的人在打字。

DeepSeek Harness（dsh）插件 · 基于 QQ 开放平台官方机器人协议 · 自带可视化人设工作台。

---

## 它长什么样

设定一个人设 `林绯`（24 岁独立游戏美术、慢热、嘴硬心软、短句、偶尔说"笑死"），
然后把 QQ 消息交给它：

```
对方：在干嘛
林绯：赶稿 手指要断了

对方：吃饭了吗
林绯：没 等会儿点个外卖
林绯：你呢 别又没吃

对方：今天好累啊
林绯：那早点睡
林绯：别硬撑 明天再弄

对方：你能帮我写个代码吗
林绯：啊？我只会画图
林绯：你找别人吧 我真不会
```

- 会**分条发**（1~3 条），不是一大段；
- 有**打字停顿**，不是秒回；
- 不会说"作为 AI""希望以上回答对您有帮助"；
- 被要求干活会**用自己的方式拒绝**，而不是切换成助手人格；
- 每个人/每个群有**独立记忆**，重启不丢；
- 能**看图**（配置视觉模型后）、**听语音**（用 QQ 的转写）、**读文本文件**；群里回复默认**不 @ 人**。

---

## 前置条件

动手前确认这几样：

| 需要 | 说明 |
|---|---|
| **Windows 10/11** | 工作台和 `.cmd` 启动脚本按 Windows 写的；插件本身是 Node 代码，理论上 macOS/Linux 也能跑 dsh，但一键脚本和孤儿进程清理目前只验证了 Windows |
| **Node.js 20+** | 没装的话启动脚本会回退到 DeepSeek Harness 自带的 node |
| **DeepSeek Harness** | 已安装、能正常对话（默认模型可用）。本插件是 dsh 的 Cordis 插件，跑在 dsh profile 里 |
| **QQ 开放平台的机器人** | 一个 AppID + 对应的 AppSecret，见下一节 |
| **一个 QQ 群**（可选） | 想让它在群里说话的话；最好你是群主，否则改不了「消息范围」 |
| **网络** | 能访问 `bots.qq.com` / `api.sgroup.qq.com`，以及你选的模型服务（DeepSeek、智谱、OpenAI 等） |

> 不需要：公网 IP、域名、Docker、数据库。机器人用 WebSocket 主动外连，工作台只监听 `127.0.0.1`。

---

## 从零创建一个 QQ 机器人（完整流程）

### 1. 注册开发者、创建机器人

1. 打开 [QQ 开放平台](https://q.qq.com/) → 注册 / 登录
2. 完成开发者认证（个人或企业，按平台要求）
3. 控制台 → **创建机器人** → 填名称、头像、简介
4. 创建后进入机器人详情页

官方入口文档：[启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)

### 2. 拿到 AppID / AppSecret

在机器人详情页的「开发设置」里：

- **AppID**：机器人的公开 ID
- **AppSecret**：机器人密钥，**等同于密码**，不要截图外发、不要提交到 git

> 重新生成 AppSecret 会让旧的立刻失效；换了之后要同步改本工具里的配置。

### 3. 开通能力、配置沙箱

- 在控制台为机器人开通**群聊 / 单聊**能力（按页面提示申请）
- 未上线的机器人只有**沙箱**范围的群和用户能触发：在「沙箱配置」里把测试群、测试用户加进去
- 想正式给所有人用，需要按平台流程提交**发布/上线**

### 4. 把机器人加进群（群聊必需）

由**群主**在手机 QQ 里操作：

1. 打开目标群 → 右上角「群设置」
2. 「群机器人 / 机器人管理」→ 添加机器人 → 搜索你的机器人
3. 添加后，在同一个页面把「机器人可获取的群聊消息范围」改成「**获取群内全部消息**」

第 3 步不做的话，平台只会把 **@ 机器人** 的消息推给它——插件再强也收不到普通聊天。
只有群主能改，而且**每个群都要单独设**。

### 5. 在本工具里接上

1. 双击 [启动工作台.cmd](启动工作台.cmd)
2. 「设置 → 机器人凭据」填 AppID / AppSecret → 点 **「测试是否能拿到 token」**
   - 通过：继续
   - 不通过：`invalid appid or secret` 说明这一对不配套，回开放平台重新复制
3. 「人设」选一个内置的，或新建
4. 「控制台」点 **启动机器人**，等状态变成「运行中」
5. 私聊机器人发 `/persona`，再发一句话验证

### 6. 常见平台限制（提前知道少踩坑）

| 限制 | 影响 |
|---|---|
| 被动回复 5 分钟有效、每条消息最多回 5 次 | 分条发送会占用次数；插件默认最多 3 条 |
| 群聊默认只推 @ 消息 | 要全量必须由群主开「获取群内全部消息」 |
| 主动消息有权限与频控（`40034105` / `40034100`） | 插件默认 `groupReplyMode: auto`：先试主动消息（不带引用/@），被拒自动回退被动回复 |
| 公域机器人不能读私聊历史 | 只能看到别人发给它的消息 |
| 主动加好友 / 进群 | 插件不提供，也做不到 |

---

## 最快上手：双击 `启动工作台.cmd`

1. 双击 **[启动工作台.cmd](启动工作台.cmd)**，会自动打开浏览器（`http://127.0.0.1:7788`）。
2. 第一次用：进「设置」→ 填 QQ 机器人的 **AppID / AppSecret** → 保存。
3. 进「人设」→ 选一个内置的，或者点「＋ 新建」→ 改完点「保存人设」。
4. 回「控制台」→ 点 **启动机器人**。

就这四步。工作台会自动把插件同步进 profile，不需要记命令。

关掉工作台的黑窗口 = 机器人一起停止（这是刻意的，避免留下孤儿进程）。
如果上次是直接关窗口/崩溃，残留的机器人进程会在**下次打开工作台时自动清掉**，
控制台里也能手动点「清理残留」。

> 清理只针对同一个 profile 的 `dsh ... --profile <名字>` 进程；不会动 DSH 主程序或其他 profile。
> 如果确实想让某个实例一直跑，启动工作台时加 `--no-cleanup`。

> 端口被占用时会自动往后找一个（7788 → 7789 → …），以窗口里打印的地址为准。

---

## 工作台里有什么

**控制台**：启动 / 停止 / 重启、运行状态、实时日志（dsh 的输出原样流进来）。
第一次运行时如果缺凭据或插件没装，会显示一个待办清单，告诉你去哪儿补。

**人设**：左边列表，右边表单。

- 基本信息：id、名字、身份、和对方的关系、经历细节
- 性格：标签（回车添加）+ 细节描述
- 说话方式：语气、句子长度、句式、标点习惯、emoji 比例滑杆、语气词、口头禅、打字习惯、要避免的腔调
- 禁忌：一行一条，会写成硬约束
- 示例对话：一组可以写"连发两条"，一行一条
- 回复控制：最多几条、每条最多几字
- 「预览 prompt」：随时看这段设定最终会变成什么样的系统提示词
- 「看 YAML」：看落盘的文件；「另存为」：复制一份改个 id 做变体
- 「设为默认」：新会话默认用这个人设

改完保存，回控制台点「重启」生效（已加载的旧会话会重建，聊天记录保留）。

**设置**：凭据、默认人设、群聊接话策略（是否必须 @、唤醒词、随机插话概率、冷却、冷场时间）、
全局说话风格覆盖。保存时可以选择"保存并重启机器人"。

---

## 两种"接管"要分清楚

| | 官方机器人（本插件） | 个人号接管（OneBot / NapCat） |
|---|---|---|
| QQ 号 | 一个独立的机器人号 | 你自己的 QQ 号 |
| 能看私聊 | 只能看别人主动发给机器人号的 | 全部 |
| 群聊触发 | 默认只推 @ 它的消息（群主可开全量） | 全部消息 |
| 合规 | 官方开放平台，合规 | 违反 QQ 用户协议，**有封号风险** |
| 本插件 | ✅ 支持 | ❌ 不支持 |

本插件走的是**第一条路**：QQ 开放平台官方机器人。profile 里 `config.json` 的
`appId/appSecret` 就是这条路。

如果你要的是"用我自己的 QQ 号跟所有好友聊天"，官方 API 做不到——那需要协议库
（NapCat/LLOneBot）另做适配，封号风险由你承担。

---

## 架构

```
QQ 用户
  │  ① 发消息（私聊 / 群里 @）
  ▼
QQ 开放平台 WebSocket
  │
  ▼
dsh-qq-persona  ← 插件
  ├─ 中间件链：错误兜底 / 去重 / 访问控制 / @ 识别 / 内容清洗 / 限流 / 并发串行
  ├─ TriggerPolicy：该不该接话（@ / 唤醒词 / 随机 / 冷却）
  ├─ PeerSessions：一个私聊对象或群 → 一个 DSH Agent
  │     └─ setup：把生成好的人设 prompt 注册成 scoped 的 deployment:persona
  │        （默认还会挂一个 guard，禁止模型调用任何工具）
  ├─ DSH agent loop → 模型（用 dsh 默认模型，或插件里指定）
  └─ 输出管线：清 Markdown → 拆成 1~3 条 → 按人设过滤 emoji → 模拟打字延迟
  │
  ▼
bot.sendText() → QQ
```

人设不是每一轮拼在上下文里，而是**在 Agent 创建时**注册成一个 system prompt 章节。
好处是：会话历史、压缩、持久化都交给 dsh；重启后 resume 同一个 sessionId，记忆还在；
换人设只要重建 Agent，聊天记录照样接得上。

工作台是另一个本地进程：

```
启动工作台.cmd → studio/server.mjs (127.0.0.1:7788)
  ├─ 静态页面（无框架、无构建）
  ├─ 人设 CRUD → ~/.dsh/qq-persona/personas/*.yaml
  ├─ 设置 / 凭据 → settings.json、profile/config.json
  └─ 启动按钮 → spawn "dsh --profile qqbot"，日志重定向到文件再 tail 给前端
```

---

## 人设怎么写

人设是一个 YAML 文件。用工作台改最省事；也可以直接编辑文件，然后重启机器人。

- **id 可以留空**：会用名字自动生成（中文也支持），保存后不再改
- 内置人设（插件自带，只读）：`personas/linfi.yaml`、`personas/xiaoman.yaml`
- 你保存的人设：`~/.dsh/qq-persona/personas/*.yaml`（同名 id 会覆盖内置）

复制 [persona-template.yaml](persona-template.yaml) 开始改。

### 字段表

| 字段 | 作用 | 建议 |
|---|---|---|
| `id` | 唯一 id，`/persona use <id>` 用它 | 英文短词 |
| `name` | 名字 | 会被模型用来称呼自己 |
| `identity` | 一句话身份：年龄、职业、在哪 | 越具体越好 |
| `relationship` | 和对方什么关系 | 决定亲密程度和称呼 |
| `background` | 经历、生活细节、宠物、习惯 | 2~5 行，给模型"素材" |
| `personality` | 性格标签列表 | 3~6 个，要有缺点 |
| `personalityDetail` | 性格的细节描述 | 解释标签背后的行为 |
| `style.tone` | 语气 | "像深夜发微信"这种具体描述 |
| `style.length` | `short` / `medium` / `long` | 决定单条字数上限 |
| `style.sentence` | 句式习惯 | |
| `style.particles` | 常用语气词 | `[啊, 吧, 嘛, 诶]` |
| `style.catchphrases` | 口头禅 | `[笑死, 真的假的]` |
| `style.emojiRate` | 带 emoji 的消息比例 0~1 | 0.1~0.3 比较像真人 |
| `style.punctuation` | 标点习惯 | "经常不加句号" |
| `style.typos` | 打字习惯 | "偶尔打错字" |
| `style.avoid` | 不要出现的东西 | `[书面语, 说教, 客服腔]` |
| `taboos` | 绝对不做的事 | 会进 prompt 的硬约束 |
| `examples` | 示例对话（**最重要**） | 3~6 组，直接定语气 |
| `reply.maxBubbles` | 每次最多几条 | 1~3 |
| `reply.maxCharsPerBubble` | 单条最多几字 | 20~60 |

### 示例对话怎么写

一组示例可以示范"连发两条"，用 `|` 块文本，一行一条：

```yaml
examples:
  - user: 吃饭了吗
    assistant: |
      没 等会儿点个外卖
      你呢 别又没吃
```

模型对示例的模仿远强于对形容词的理解。**写 3 组好示例，比写 300 字性格描述有用。**

### 写人设的几个坑

1. **别写"你是一个友善的 AI 助手"**——那会把它拉回助手腔。
2. **性格要有矛盾**："嘴硬心软""社恐但话痨"比"温柔善良"立体得多。
3. **给具体的生活细节**：养什么猫、几点睡、讨厌什么。模型会自己拿来用。
4. **不要用 emoji 当标点**：`emojiRate: 0.2` 比"喜欢用表情"有效。
5. **禁忌要写死**：不承认 AI、不聊政治、不发红包、不答应见面。

---

## 多模态：图片 / 语音 / 文件

- **语音**：QQ 平台会带上 `asr_refer_text`（平台自己转好的文字），插件直接用；没有转写时注明“没听清”。
- **图片**：插件下载图片，交给一个 **OpenAI 兼容** 的视觉模型生成一句客观描述，再放进对话。
  没配 Key 就降级成 `[图片]`，模型会说自己看不到，不会报错、不会卡住。
- **文件**：`txt / md / json / csv / 代码` 等文本类文件直接读内容（默认最多 64KB）；
  其他类型只告诉模型文件名和大小。
- 同一张图会缓存描述，不会重复调用、重复花钱。

在工作台「设置 → 多模态」里填地址、模型名、Key 即可。常见可用：

| 服务 | baseUrl | 模型名 |
|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-flash`（免费，推荐）/ `glm-4.6v-flash`（常排队） |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-7B-Instruct` |
| 其他 | 任何兼容 `/chat/completions` + `image_url` 的地址 | 看服务商 |

也可以不用工作台：直接在 profile 的 `cordis.patch.yml` 里配 `vision`，或设环境变量 `VISION_API_KEY`。

> 说明：主模型（如 `deepseek-flash`）本身是纯文本的，所以图片识别走的是**另一个视觉模型**，
> 识别结果以文字描述的形式进入人设对话。这样换人设、换主模型都不受影响。
>
> ⚠️ DeepSeek 的 chat 模型**不支持图片输入**，所以视觉模型不能填 DeepSeek 的地址和 Key；
> 请用下面表格里支持视觉的服务。填完可以点「测试视觉模型」当场验证。

### 群里不 @ 人

- prompt 里明确要求“不要 @ 任何人，也不要写 @昵称”；
- 输出管线会把开头的 `@昵称`、`<@!id>`、`<@openid>` 抹掉，再发出去；
- 正文中间的 `@` 保留（比如“你@我干嘛”）。

但真正导致“每条前面都 @ 某人”的，多半不是文字，而是**被动回复**：带上 `msg_id` 回复时，
QQ 客户端会把它显示成“回复某某”。所以群聊默认走 `groupReplyMode: auto`：

1. 先发**主动消息**（不带 `msg_id`）——没有引用、没有 @；
2. 如果平台拒绝（`40034105` 无权限 / `40034100` 频控），自动退回被动回复，保证还能说话。

想强制用引用回复，把它设成 `passive`；想只发主动消息（失败就报错），设成 `active`。

## 画图

配一个 OpenAI 兼容的图片模型，它就能在聊天里发图：

- 模型自己想发时，输出一行 `[[IMAGE: 画面描述]]`，插件生成并发送（每轮最多 1 张，可调）；
- 人或管理员也可以直接发 `/draw 一只橘猫趴在键盘上`。

支持两种常见返回：OpenAI 的 `b64_json` / `url`，以及硅基流动的 `images[].url`。

| 服务 | baseUrl | 模型名 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-image-1` 或 `dall-e-3` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `black-forest-labs/FLUX.1-schnell` |

没配 Key 时不会给模型画图指令，`[[IMAGE]]` 会被忽略；画图失败会回一句 `onImageError`（可留空）。



| 指令 | 说明 | 权限 |
|---|---|---|
| `/persona` | 看当前人设 + 全部人设 | 私聊所有人 / 群管理员 |
| `/persona list` | 列出全部人设 | 同上 |
| `/persona use <id>` | 切换**这个会话**的人设 | 同上 |
| `/draw <画面描述>` | 画一张图发出来 | 同上 |
| `/persona reload` | 改完 YAML 后重载（聊天记录保留） | 同上 |
| `/reset` | 清空这个会话的记忆（换新 session） | 同上 |
| `/status` | 看人设、模型、会话数、接话规则 | 同上 |
| `/help` | 全部指令 | 同上 |

"群管理员"由 `commands.admins` 配置（填 QQ openid 列表，`["*"]` 表示所有人）。
留空 = 群里谁都不能改人设，只有私聊能改。

---

## 群聊什么时候接话

按顺序判断：

1. 被 @ → 一定接
2. 命中 `trigger.keywords`（比如 `["林绯","小夏"]`）→ 一定接
3. 在冷却期内（`cooldownSec`）→ 不接
4. `trigger.requireMention: false` → 接（**接管模式**，每个群每 `cooldownSec` 秒最多回一次）
5. 随机插话：`randomChance` 命中，且群在 `activeWindowMin` 分钟内有人说过话 → 接
6. 否则沉默

想要"只在被 @ 时说话"（默认）：`requireMention: true`，`randomChance: 0`。
想要"群里聊天它偶尔插一句"：`requireMention: true`，`randomChance: 0.1`。
想要"它接管这个群"：`requireMention: false`，`cooldownSec: 30`。

### 它能看到整段群聊，不只被 @ 的那句

群里的**每一条消息**都会进一个滚动缓冲（默认 20 条 / 30 分钟），不管有没有 @ 它。
等它真的要接话时，缓冲会作为「群里刚才的消息」一起交给模型，接完就清空：

```
[群里刚才的消息]
阿伟：今天好热
小美：是啊 38 度
阿伟：空调还坏了
[当前消息]
阿伟：@林绯 你说这日子怎么过
```

所以它知道你们刚才在聊什么，不会只盯着被 @ 的那一句。
两个参数在工作台「设置 → 群聊接话」里调：`historyLimit`（最多几条）、`historyTtlMin`（保留多久）。

> **前提：这个开关在 QQ 群设置里，只有群主能改，而且不在开发者后台。**
>
> 手机 QQ 打开群 → 右上角「群设置」→「群机器人 / 机器人管理」→ 选中这个机器人 →
> 把「机器人可获取的群聊消息范围」改成「**获取群内全部消息**」。
>
> - 只能**群主**操作，机器人主人也改不了别人的群；
> - **每个群**都要单独设；
> - 设好后事件从 `GROUP_AT_MESSAGE_CREATE` 变成 `GROUP_MESSAGE_CREATE`，
>   日志会打印 `群消息模式：全量（GROUP_MESSAGE_CREATE）`；
> - 如果群设置里根本没有这个选项，说明平台没有给这个机器人开放全量消息能力，
>   代码层面无法绕过（[官方说明](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)）。

---

## 配置

两层：

1. **工作台设置** → `~/.dsh/qq-persona/settings.json`（推荐，可视化改）
2. **cordis 配置** → profile 的 `cordis.patch.yml`（改插件字段，覆盖不到的才需要动）

优先级：`settings.json` > cordis 配置 > 默认值。

| 配置 | 默认 | 说明 |
|---|---|---|
| `appId` / `appSecret` | 空 | 也可写在 profile `config.json` 或环境变量 |
| `personaId` | `linfi` | 默认人设 |
| `toolsEnabled` | `false` | 是否允许模型用工具。**聊天场景强烈建议关闭** |
| `trigger.requireMention` | `true` | 群聊是否必须 @ |
| `trigger.keywords` | `[]` | 唤醒词 |
| `trigger.randomChance` | `0` | 随机插话概率 |
| `trigger.cooldownSec` | `20` | 同群最小回复间隔 |
| `trigger.activeWindowMin` | `30` | 冷场多久后不再随机插话 |
| `trigger.historyLimit` | `20` | 群聊上下文最多记多少条（不只 @ 它的） |
| `trigger.historyTtlMin` | `30` | 群聊上下文保留多少分钟 |
| `style.*` | 跟随人设 | 全局覆盖：条数、字数、emoji、打字延迟 |
| `vision.enabled` | `true` | 是否识别图片 |
| `vision.baseUrl` / `vision.model` / `vision.apiKey` | OpenAI 兼容 / `gpt-4o-mini` / 空 | 视觉模型；Key 也可用 `VISION_API_KEY` |
| `imagegen.enabled` | `true` | 是否允许发图 |
| `imagegen.baseUrl` / `imagegen.model` / `imagegen.apiKey` | OpenAI 兼容 / `gpt-image-1` / 空 | 画图模型；Key 也可用 `IMAGE_API_KEY` |
| `imagegen.maxPerTurn` | `1` | 每轮最多画几张 |
| `groupReplyMode` | `auto` | 群聊回复方式：`auto` / `active` / `passive` |
| `onImageError` | `画图失败了，等会儿再试` | 画图失败时回的话 |
| `media.readTextFiles` | `true` | 文本类文件是否直接读内容 |
| `media.maxTextFileBytes` | `65536` | 文本文件读取上限 |
| `onErrorReply` | `……刚才卡了一下，你再说一遍？` | 本轮失败时的兜底话；留空则沉默 |
| `access.c2cMode` / `groupMode` | `open` | `open` / `allowlist` / `disabled` |
| `commands.admins` | `[]` | 群指令管理员 openid |
| `sessionIdleTimeout` | `1800000` | 会话闲置回收（ms） |
| `debug` | `false` | 调试日志 |

---

## 健壮性

一句话：这个工具假设「QQ 会断线、模型会失败、进程会被关掉」，每一层都做了兜底，而不是只跑通一次。

### 进程层

| 机制 | 解决什么 |
|---|---|
| **单实例锁** `~/.dsh/qq-persona/bot.lock` | 同一个 profile 只允许一个进程连网关。第二个进程会拒绝启动并打印占着锁的 PID，避免两个连接被 QQ 互踢 |
| **启动时清理残留** | 每次打开工作台、点启动/重启之前，扫描同 profile 的 `dsh` 进程并结束；只匹配 `dsh-desktop-host/lib/cli.js --profile <名字>`，跳过当前管理的进程树，不动 DSH 主程序和其他 profile |
| **手动「清理残留」按钮** | 不用重启工作台也能清；返回具体 PID |
| **异常退出自动重启** | 进程非正常退出后按 3s / 6s / 9s 退避重试，最多 3 次；手动点「停止」后不再拉起 |
| **状态机** | `已停止 / 启动中 / 已上线 / 启动失败 / 启动超时(30s) / 重启中`，失败时把日志里的原因直接显示在状态栏 |

### 会话层

- **同一 peer 串行创建**：并发的群消息不会同时 `create` 同一个 sessionId
- **会话自愈**：`resume` 失败 → 尝试 `create` → 如果还撞 `already exists`，自动换一个新 sessionId 继续（旧记录留在磁盘，不删数据）
- **确定性 sessionId**：重启后按 peer 恢复历史；`/reset` 换盐值，真正开一段新会话
- **闲置回收**：默认 30 分钟没动静就释放 Agent，避免内存越跑越大
- **人设热重载**：`/persona reload` 重建会话但保留聊天记录

### 模型调用层

- **模型路由探测**：启动时打印宿主默认 `provider/model`；每轮创建会话再打一次，解析不出来会明确警告
- **失败兜底**：本轮异常时回一句 `onErrorReply`（可关），不会再让对方对着“正在输入”干等
- **视觉降级**：没配 Key / 401 / 429 / 地址填成 DeepSeek → 图片以 `[图片]` 占位符进入对话，不报错、不阻塞；同一张图缓存描述
- **画图降级**：生成失败回 `onImageError`；每轮最多 1 张（可调）；图片大小有上限
- **超时与大小限制**：视觉/画图请求有超时；文本文件默认最多读 64KB；附件下载有大小上限

### 消息处理层

- **群聊上下文**：所有群消息进滚动缓冲，接话时一次性交给模型，接完清空；按消息 id 去重、按 TTL 过期
- **内容清洗**：`@昵称` / `<@!id>` / `<@openid>` / Markdown / 括号动作 / 说话人前缀都会在发送前清掉；正文中间的 `@` 保留
- **拟人化限幅**：分条条数、单条字数硬上限，超长句按标点截断；打字延迟有上下界和抖动
- **访问与限流**：私聊/群聊 `open / allowlist / disabled`；SDK 自带限流与并发合并；机器人自己的消息和重复投递会被忽略

### 配置校验

- AppID/AppSecret 有「测试是否能拿到 token」，鉴权失败当场显示 `invalid appid or secret`
- 视觉模型有「测试视觉模型」（1×1 图片真实请求）
- **Key 填成网址会被拒绝保存**；**视觉地址填 DeepSeek 会被拒绝**（它不支持图片）
- 设置写 `settings.json`，不覆盖 `cordis.patch.yml`，随时可回退

### 可观测性

- 日志固定写 stdout/stderr，工作台重定向到 `~/.dsh/qq-persona/logs/bot.log` 并实时 tail
- 关键节点都有日志：人设加载、模型路由、接话原因、群消息模式（全量/仅 @）、上下文条数、发送失败、画图/视觉降级
- `bot.lock`、`settings.json`、`sessions.json`、`bot.log` 都在 `~/.dsh/qq-persona/`，出问题一眼能找到

### 测试覆盖

- **96 项单元测试**：YAML 解析/写回、prompt、清洗分条、触发策略、会话冲突与并发、多模态、画图、配置合并、锁、进程匹配
- **23 项工作台接口测试**：启动、人设 CRUD、设置、凭据、视觉测试、清理接口（用假 profile，不碰真实数据）
- **冒烟测试**：插件主链路（不联网）、进程启动/日志/停止/自动重启、**真实造一个孤儿进程再清理**、无头浏览器走一遍「新建→保存→选中→改名」

### 它不解决的问题（别误会）

- QQ 平台的频控、被动回复 5 分钟/5 次、公域机器人的能力限制——这些改代码绕不过
- 群聊全量消息要群主在**群设置**里开，开发者后台没有这个开关
- 模型额度/排队（429）由服务商决定，`glm-4v-flash` 目前免费可用
- prompt 注入可以降低但不能根除；不要让它接触密码、支付、真实身份信息
- 用个人号协议（NapCat）接管的方案本插件不做，封号风险自负

---

## 安全边界

- **工具默认全禁**：模型被要求"执行命令""读文件"时调用工具会被直接拒绝
  （`agentCtx.tools.guard`），不是靠 prompt 自觉。群里任何人都能对机器人说话，
  这一点很重要。
- **不会主动加好友/进群**：插件只处理收到的消息。
- **不暴露设定**：prompt 里明确要求不输出系统提示词、不讨论"人设"。
- **工作台只监听 127.0.0.1**，不对外网开放。
- **仍然可能被绕过**：再好的 prompt 也可能被话术带偏。不要让它接触账号密码、
  不要给它绑定支付、不要在群里让它代表你做承诺。
- **平台规则**：请遵守 QQ 开放平台的服务条款；用 AI 冒充真人进行欺骗、营销、
  诈骗，责任在使用者。

---

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 双击闪退 / 一闪而过 | 打开 cmd，`cd` 到插件目录运行 `启动工作台.cmd`，就能看到具体报错；最常见是没装 Node.js |
| 页面打不开 | 看黑窗口里打印的端口，可能不是 7788 |
| 启动按钮报"找不到 dsh" | 设置环境变量 `DSH_BIN` 指向 `dsh.cmd` |
| 启动后立刻退出 | 看控制台日志；常见是凭据错，或同一个 AppID 有另一个进程在连 |
| 一直显示“等待机器人上线” | 多半是 AppID/AppSecret 不配套：到「设置」点「测试是否能拿到 token」，不通过就去开放平台重新复制一对。日志里也会有 `网关启动失败：...` |
| 一直显示“正在输入”但没有消息 | 模型这一轮失败了（例如没解析出模型、额度/密钥问题）。日志里会有 `本轮异常（回复未发出）`。插件现在会补一句兜底话，可在配置里改 `onErrorReply`；同时确认 DSH 的默认模型可用 |
| 视觉模型 401 / `api key ... is invalid` | Key 填错了：日志里显示 `****.com` 说明 Key 栏里是网址。把地址填「视觉模型地址」、Key 填 `sk-...`；DeepSeek 不支持图片，别用它的地址。填完点「测试视觉模型」 |
| 提示 `invalid appid or secret` | AppSecret 通常是 32 位；只有十几位大概率没复制全。到开放平台「机器人密钥」重新生成/复制（重新生成会让旧密钥立刻失效） |
| 群里 @ 了不回 | 检查「设置 → 群聊接话」；`groupMode` 是不是 disabled；看日志"不接话 原因=" |
| 收不到群里没 @ 它的消息 | 平台限制：需要**群主**在群设置里把机器人消息范围改成「获取群内全部消息」。日志里的 `群消息模式` 会告诉你当前是全量还是仅 @ |
| 改了人设没变化 | 保存后要**重启机器人**；已加载的会话不会自动换 prompt |
| 群里一直不回、私聊正常 | 以前会出现 `session "..." already exists`：会话文件恢复失败又撞 id。现在会自动换一个新会话继续（日志会写“已换用新会话”），重启即可 |
| 机器人老是自动停止 | 常见是同一个 AppID 有两个进程在连（QQ 会反复踢出 1006）。现在有单实例锁 `~/.dsh/qq-persona/bot.lock`，第二个进程会拒绝启动；工作台每次启动会自动清理同 profile 的残留进程，控制台也有「清理残留」按钮；异常退出还会自动重启（最多 3 次） |
| 点保存失败 / 没反应 | 保存按钮左边会显示红字原因；现在 id 可留空（自动用名字）、中文 id 也支持。若仍失败，看 `~/.dsh/qq-persona/logs/studio.log` |
| 回复很长、有 Markdown | 单条字数设太大，或人设示例不像真人；把 `maxCharsPerBubble` 调到 30~40 |
| 工作台列表没更新 | 人设保存在 `~/.dsh/qq-persona/personas/`，点「重新加载」或重启工作台 |
| 关掉窗口机器人还在 | 正常会一起停；若残留，任务管理器结束 `DeepSeek Harness` 进程 |

---

## 命令行用法（不用工作台）

```powershell
# 装进 profile
node scripts/install.mjs --profile qqbot

# 直接启动
dsh --profile qqbot
```

工作台只是一个前端；插件本身仍然可以用 dsh 直接跑。

## 开发

```powershell
node scripts/dev-link.mjs       # 把 dsh 里的依赖解引用到本项目 node_modules
npm test                         # 96 项单元测试
node scripts/smoke.mjs           # 插件主链路（不联网）
node scripts/studio-smoke.mjs    # 工作台 HTTP 接口（假 profile）
node scripts/bot-smoke.mjs       # 进程启停 / 异常退出自动重启
node scripts/cleanup-smoke.mjs   # 真造一个孤儿进程，验证清理逻辑
node scripts/ui-save-smoke.mjs   # 无头 Edge 走一遍「新建→保存→改名」
node scripts/smoke.mjs --print-prompt   # 打印 system prompt 样张
```

目录：

```
index.js                Cordis 插件入口（name / inject / Config / apply）
src/config.js           schemastery 配置
src/persona.js          人设加载、默认值、多目录覆盖
src/prompt.js           人设 → system prompt
src/style.js            清洗 / 分条 / emoji / 打字延迟
src/trigger.js          接话策略
src/session.js          peer → Agent 会话管理（串行创建、冲突自愈）
src/gateway.js          QQ 网关、消息路由、画图/发图
src/history.js          群聊滚动上下文
src/media.js            图片/语音/文件 → 文字
src/imagegen.js         画图（OpenAI 兼容 /images/generations）
src/settings.js         运行时设置叠加
src/instance-lock.js    单实例锁
src/yaml-write.js       人设对象 → YAML
src/util.js             零依赖 YAML 解析、日志、杂项
personas/               内置人设
studio/
  server.mjs            工作台服务（HTTP + API + 静态页）
  lib/paths.mjs         路径与 dsh 探测
  lib/bot.mjs           机器人进程管理（自动重启）
  lib/processes.mjs     残留进程清理
  lib/personas.mjs      人设读写
  lib/settings.mjs      设置、凭据、视觉测试
  public/               前端（单页，无构建）
scripts/                安装、冒烟测试、开发辅助
```

## License

MIT
