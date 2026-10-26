/**
 * 斜杠指令：不打断人设对话的“后台遥控器”。
 *
 * 私聊里任何人都能用（那就是号主本人）；群里默认只有 commands.admins
 * 里的人能用，避免群友把机器人的人设改成奇怪的东西。
 */
import { describePersona } from './prompt.js';

export function buildCommands({ config, personas, sessions, overrides, imagegen, logger }) {
  const peerOf = (mCtx) => {
    const msg = mCtx.message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? msg.groupOpenid ?? msg.senderId : msg.senderId;
    return { scope, peerId, peerKey: `${scope}:${peerId}` };
  };

  const isAdmin = (mCtx) => {
    if (mCtx.message.kind !== 'group') return true;
    const admins = config.commands.admins ?? [];
    return admins.includes('*') || admins.includes(mCtx.message.senderId);
  };

  const requireAdmin = (mCtx) => (isAdmin(mCtx) ? true : '群里只有管理员能改人设～');

  const listText = () =>
    personas
      .list()
      .map((persona) => `· ${persona.id} — ${describePersona(persona)}`)
      .join('\n');

  const switchTo = async (mCtx, id) => {
    const target = personas.get(id);
    if (!target) {
      return `没有这个「${id}」。可用：${personas.list().map((item) => item.id).join(', ')}`;
    }
    const { scope, peerId, peerKey } = peerOf(mCtx);
    overrides.set(peerKey, target.id);
    await sessions.remove(scope, peerId, { quiet: true });
    logger.info(`切换人设 peer=${peerKey} → ${target.id}`);
    return `好，现在由「${target.name}」来聊。\n${describePersona(target)}`;
  };

  return [
    {
      name: ['persona', '人设'],
      description: '查看或切换当前人设',
      usage: '[list | use <id> | reload]',
      scope: 'all',
      authorized: requireAdmin,
      handler: async (mCtx) => {
        const { peerKey } = peerOf(mCtx);
        const args = mCtx.command?.args ?? [];
        const current = sessions.personaFor(peerKey);

        if (args.length === 0) {
          return [
            `当前人设：${current.name}（${current.id}）`,
            describePersona(current),
            '',
            `全部人设：`,
            listText(),
            '',
            '切换：/persona use <id>',
          ].join('\n');
        }

        const action = args[0].toLowerCase();
        if (action === 'list' || action === '列表') {
          return [`全部人设（共 ${personas.size} 个）：`, listText()].join('\n');
        }

        if (action === 'reload' || action === '重载') {
          try {
            personas.load();
            await sessions.resetAll();
            const broken = personas.errors.length > 0 ? `\n有 ${personas.errors.length} 个文件没加载成功：\n${personas.errors.join('\n')}` : '';
            return `已重载 ${personas.size} 个人设，会话已重建（聊天记录还在）。${broken}`;
          } catch (error) {
            return `重载失败：${error instanceof Error ? error.message : String(error)}`;
          }
        }

        if (action === 'use' || action === '切换') {
          return switchTo(mCtx, args[1] ?? '');
        }

        // 也允许 /persona linfi 这种简写
        return switchTo(mCtx, args[0]);
      },
    },
    {
      name: ['draw', '画图'],
      description: '画一张图并发出来',
      usage: '<画面描述>',
      scope: 'all',
      authorized: requireAdmin,
      handler: async (mCtx) => {
        if (!imagegen?.enabled) {
          return '还没配画图模型。去工作台「设置 → 画图」填地址和 Key。';
        }
        const prompt = String(mCtx.command?.raw ?? '').trim();
        if (!prompt) return '用法：/draw 一只橘猫趴在键盘上';
        // 先回一句，图生成完再补发
        imagegen
          .generate(prompt)
          .then((image) => mCtx.bot.sendImage(mCtx.replyTarget, { buffer: image.buffer }))
          .catch((error) => {
            logger.warn(`/draw 失败：${error instanceof Error ? error.message : String(error)}`);
            mCtx.bot
              .sendText(mCtx.replyTarget, `画不出来：${error instanceof Error ? error.message : String(error)}`)
              .catch(() => {});
          });
        return '画着呢…';
      },
    },
    {
      name: ['reset', '重置'],
      description: '清空当前会话的记忆',
      scope: 'all',
      authorized: requireAdmin,
      handler: async (mCtx) => {
        const { scope, peerId } = peerOf(mCtx);
        await sessions.reset(scope, peerId);
        return '记忆已清空，刚才聊的都忘了。';
      },
    },
    {
      name: ['status', '状态'],
      description: '查看运行状态',
      scope: 'all',
      authorized: requireAdmin,
      handler: (mCtx) => {
        const { peerKey } = peerOf(mCtx);
        const persona = sessions.personaFor(peerKey);
        const lines = [
          `人设：${persona.name}（${persona.id}）`,
          `身份：${persona.identity || '未填'}`,
          `性格：${persona.personality.join('、') || '未填'}`,
          `说话：${persona.style.tone}`,
          `每次最多 ${persona.reply.maxBubbles} 条 / 每条 ${persona.reply.maxCharsPerBubble} 字`,
          `工具：${config.toolsEnabled ? '开启' : '关闭（只聊天）'}`,
          `活跃会话：${sessions.size}`,
          `接话规则：${config.trigger.requireMention ? '群聊需 @' : '群聊主动接话'}${
            config.trigger.keywords.length > 0 ? `，唤醒词 ${config.trigger.keywords.join('/')}` : ''
          }`,
        ];
        return lines.join('\n');
      },
    },
  ];
}
