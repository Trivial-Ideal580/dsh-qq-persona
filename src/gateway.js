/**
 * QQ 网关：连接开放平台、串中间件、把消息交给人设 Agent，再把回复
 * 洗净、拆成多条、按“打字速度”发回去。
 */
import {
  QQBot,
  accessPolicy,
  concurrencyGuard,
  contentSanitizer,
  errorHandler,
  mentionGate,
  messageFilter,
  quoteRef,
  rateLimiter,
  slashCommand,
  typingIndicator,
} from '@tencent-connect/qqbot-nodejs';
import { resolveReplyStyle } from './persona.js';
import { formatHistoryBlock, GroupHistory, summarizeForHistory } from './history.js';
import { extractImageRequests } from './imagegen.js';
import { renderReply, typingDelayMs } from './style.js';
import { errorText, randomBetween, sleep } from './util.js';

/** 从 QQ 消息里拼出给模型看的一句话（含群聊上下文与多模态内容）。 */
export async function buildBody(msg, mCtx, media, recent = []) {
  // 群里 @ 人会变成 <@member_openid>，对模型没意义，先去干净
  const content = String(msg.content ?? '')
    .replace(/<@[^>]*>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const parts = [];

  const historyBlock = msg.kind === 'group' ? formatHistoryBlock(recent) : '';
  if (historyBlock) parts.push(historyBlock);

  const quote = mCtx.state?.quote?.text;
  if (quote) parts.push(`（对方在回复这条：${String(quote).slice(0, 80)}）`);

  if (msg.kind === 'group') {
    parts.push(content ? `${msg.senderName || '对方'}：${content}` : `${msg.senderName || '对方'}：`);
  } else if (content) {
    parts.push(content);
  }

  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  if (attachments.length > 0 && media) {
    parts.push(...(await media.describe(attachments)));
  }
  return parts.filter(Boolean).join('\n');
}

export async function startGateway({
  ctx,
  config,
  appId,
  appSecret,
  personas,
  sessions,
  policy,
  media,
  imagegen,
  commands,
  logger,
}) {
  const bot = new QQBot({
    appId,
    appSecret,
    transport: 'websocket',
    userAgent: `dsh-qq-persona/0.1.0 (Node/${process.versions.node})`,
    logger,
  });

  // 群里所有消息都进这里；等它接话时一次性交给模型，再接完清空
  const history = new GroupHistory({
    limit: config.trigger?.historyLimit ?? 20,
    ttlMs: (config.trigger?.historyTtlMin ?? 30) * 60_000,
    logger,
  });
  /** 每个群各自记录“见过哪种事件”，用来告诉用户平台当前给的是全量还是仅 @ */
  const seenEventTypes = new Set();

  const access = config.access ?? {};
  const c2cMode = access.c2cMode ?? 'open';
  const groupMode = access.groupMode ?? 'open';
  const c2cAllow = Array.isArray(access.c2cAllow) ? access.c2cAllow : [];
  const groupAllow = Array.isArray(access.groupAllow) ? access.groupAllow : [];

  // ── 中间件 ────────────────────────────────────────────
  bot.use(errorHandler());
  bot.use(messageFilter({ skipSelfEcho: false }));
  bot.use(
    accessPolicy({
      c2c: {
        mode: c2cMode,
        allow: c2cAllow.length > 0 ? c2cAllow : ['*'],
      },
      group: {
        mode: groupMode,
        allow: groupAllow.length > 0 ? groupAllow : ['*'],
      },
      onBlock: (_mCtx, reason) => {
        if (config.debug) logger.debug(`访问控制拦截：${reason}`);
      },
    }),
  );
  // 只记录 @ 状态，不在这里拦截 —— 是否接话交给 TriggerPolicy 决定。
  bot.use(mentionGate({ requireMentionInGroup: false }));
  bot.use(contentSanitizer({ parseFaceTags: true }));
  bot.use(rateLimiter());
  if (commands.length > 0) {
    const slash = slashCommand({ prefixes: ['/', '／'], autoHelp: true, commands });
    bot.use(slash.middleware);
  }
  bot.use(
    concurrencyGuard({
      strategy: 'merge',
      maxQueue: config.maxQueue ?? 20,
      maxProcessingMs: config.processingTimeoutMs ?? 120_000,
    }),
  );
  bot.use(typingIndicator());
  bot.use(quoteRef({ maxSize: 500, preferMsgElements: true }));

  // ── 入站 ──────────────────────────────────────────────
  bot.on('message', async (mCtx) => {
    try {
      await handleInbound(mCtx);
    } catch (error) {
      logger.error(`处理消息失败：${errorText(error)}`);
    }
  });

  async function handleInbound(mCtx) {
    const msg = mCtx.message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? msg.groupOpenid ?? msg.senderId : msg.senderId;
    if (!peerId) return;
    // 别把自己发的消息当成群聊上下文
    if (msg.senderIsBot) return;

    const text = (msg.content ?? '').trim();
    if (!text && (!msg.attachments || msg.attachments.length === 0)) return;

    const peerKey = `${scope}:${peerId}`;
    const wasMentioned = mCtx.state?.mention?.wasMentioned ?? false;

    // 每个群第一次见到某类事件时提示一次：全量模式 vs 仅 @ 模式
    if (scope === 'group') {
      const eventType = String(msg.rawEventType ?? 'unknown');
      const marker = `${peerKey}|${eventType}`;
      if (!seenEventTypes.has(marker) && seenEventTypes.size < 500) {
        seenEventTypes.add(marker);
        if (eventType === 'GROUP_MESSAGE_CREATE') {
          logger.info(`群消息模式：全量（${eventType}）——能收到群里所有消息`);
        } else {
          logger.info(
            `群消息模式：仅 @（${eventType}）——收不到普通消息。需要群主在「群设置 → 群机器人 → 消息范围」改成「获取群内全部消息」`,
          );
        }
      }
    }

    policy.noteHuman(peerKey);
    const decision = policy.decide({ scope, peerKey, text, wasMentioned });
    if (!decision.reply) {
      // 不接话也照样记下来：等下次接话时，模型能看到这段群聊
      if (scope === 'group') {
        const summary = summarizeForHistory(msg);
        if (summary) {
          history.append(peerKey, { name: msg.senderName, text: summary, messageId: msg.messageId });
        }
      }
      if (config.debug) logger.debug(`不接话 peer=${peerKey} 原因=${decision.reason}`);
      return;
    }

    const recent = scope === 'group' ? history.take(peerKey) : [];
    if (recent.length > 0) {
      logger.info(`带上群聊上下文 ${recent.length} 条 peer=${peerKey}`);
    }

    const persona = sessions.personaFor(peerKey);
    policy.noteReply(peerKey, decision.reason);
    logger.info(`接话 peer=${peerKey} 原因=${decision.reason} 人设=${persona.id}`);

    const record = await sessions.getOrCreate({
      scope,
      peerId,
      senderName: msg.senderName ?? '',
      replyTarget: { ...msg.replyTarget },
      persona,
    });
    if (!record.replyMode) {
      record.replyMode = config.groupReplyMode === 'passive' ? 'passive' : 'active';
    }
    sessions.deliver(record, await buildBody(msg, mCtx, media, recent));
  }

  // ── 出站 ──────────────────────────────────────────────
  ctx.on('session/event', (session, raw) => {
    try {
      const record = sessions.findBySessionId(session.header.id);
      if (!record) return;
      const type = raw?.type;

      if (type === 'assistant/message') {
        const content = raw.data?.message?.content;
        if (!Array.isArray(content)) return;
        const text = content
          .filter((block) => block?.type === 'text' && block.text)
          .map((block) => block.text)
          .join('\n')
          .trim();
        if (!text) return;
        record.sentThisTurn = true;
        record.sendChain = record.sendChain
          .then(() => deliver(record, text))
          .catch((error) => logger.error(`发送失败 peer=${record.key}：${errorText(error)}`));
        return;
      }

      if (type === 'turn/end') {
        const reason = raw.data?.reason ?? {};
        if (reason.kind === 'error') {
          const detail = reason.error ?? reason.failure ?? {};
          const code = detail.code ?? reason.code ?? 'UNKNOWN';
          const detailText = detail.message ?? reason.message ?? '';
          logger.error(`本轮异常（回复未发出）peer=${record.key} code=${code} ${detailText}`);

          // 失败时别让对方一直卡在“正在输入”：回一句兜底话
          const fallback = config.onErrorReply;
          if (fallback && record.sentThisTurn !== true) {
            record.sendChain = record.sendChain
              .then(() => sendTextSafe(record, fallback))
              .catch((error) => logger.error(`兜底消息发送失败：${errorText(error)}`));
          }
        }
        record.sentThisTurn = false;
      }
    } catch (error) {
      logger.debug(`出站事件处理异常：${errorText(error)}`);
    }
  });

  /** 群聊优先发“主动消息”（没有引用/@），被拒再退回被动回复。 */
  function activeBlocked(error) {
    return /40034105|40034100|主动消息/.test(errorText(error));
  }

  async function sendTextSafe(record, text) {
    if (record.scope === 'group' && record.replyMode === 'active') {
      try {
        return await bot.sendText({ scope: 'group', targetId: record.replyTarget.targetId }, text);
      } catch (error) {
        if (!activeBlocked(error)) throw error;
        record.replyMode = 'passive';
        logger.warn('主动消息被拒（无权限或频控），这个群改为引用回复');
      }
    }
    return bot.sendText(record.replyTarget, text);
  }

  async function sendImageSafe(record, image) {
    const source = { buffer: image.buffer, fileName: `image.${image.extension ?? 'png'}` };
    if (record.scope === 'group' && record.replyMode === 'active') {
      try {
        return await bot.sendImage({ scope: 'group', targetId: record.replyTarget.targetId }, source);
      } catch (error) {
        if (!activeBlocked(error)) throw error;
        record.replyMode = 'passive';
        logger.warn('主动图片被拒，改为引用回复');
      }
    }
    return bot.sendImage(record.replyTarget, source);
  }

  async function deliver(record, rawText) {
    const style = resolveReplyStyle(record.persona, config);
    const { text, prompts } = extractImageRequests(rawText);
    const bubbles = renderReply(text, style);

    if (bubbles.length > 0) logger.debug(`发送 ${bubbles.length} 条 → ${record.key}`);
    for (let index = 0; index < bubbles.length; index += 1) {
      const bubble = bubbles[index];
      const delay = typingDelayMs(bubble, style);
      if (delay > 0) await sleep(delay);
      await sendTextSafe(record, bubble);
      if (index < bubbles.length - 1) await sleep(randomBetween(180, 520));
    }

    // 画图：模型用 [[IMAGE: ...]] 发起，最多每轮 maxPerTurn 张
    const limit = Math.max(0, Number(config.imagegen?.maxPerTurn) || 1);
    const wanted = prompts.slice(0, limit);
    for (const prompt of wanted) {
      if (!imagegen?.enabled) {
        logger.warn(`模型想画图但没配置画图模型：${prompt.slice(0, 60)}`);
        continue;
      }
      try {
        logger.info(`画图中：${prompt.slice(0, 60)}`);
        const image = await imagegen.generate(prompt);
        await sendImageSafe(record, image);
        logger.info(`已发出图片 ${Math.round(image.buffer.length / 1024)} KB`);
      } catch (error) {
        logger.error(`画图失败：${errorText(error)}`);
        if (config.onImageError) {
          await sendTextSafe(record, config.onImageError).catch(() => {});
        }
      }
    }
  }

  // ── 生命周期 ──────────────────────────────────────────
  ctx.effect(() => {
    logger.info(`启动 QQ 网关 appId=${appId}`);
    bot.start().catch((error) => {
      const message = errorText(error);
      logger.error(`网关启动失败：${message}`);
      if (/appid|appid or secret|access_token|100016/i.test(message)) {
        logger.error(
          'AppID 和 AppSecret 不配套，QQ 拒绝了鉴权。到工作台「设置」点“测试是否能拿到 token”确认，再去开放平台重新复制一对。',
        );
      }
      logger.error(`机器人没有上线，进程会保持存活；修好凭据后在工作台点“重启”。`);
    });
    return async () => {
      logger.info('关闭 QQ 网关');
      history.clear();
      await sessions.disposeAll();
      try {
        bot.stop();
      } catch {
        // 忽略
      }
    };
  }, 'im-qq-persona.lifecycle');

  bot.on('error', (error) => logger.error(`QQ 网关错误：${errorText(error)}`));
  bot.on('ready', () => {
    logger.info(`机器人已上线 appId=${appId}，当前人设 ${sessions.personas.resolve(config.personaId).name}`);
  });

  return bot;
}
