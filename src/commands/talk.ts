import { Bot, type Context } from "grammy";
import { syncFromTickTickToDb } from "../services/sync-orchestrator.service";
import {
  buildTalkTopicSummariesForUser,
  closeTalkTopicTasksAfterSummary,
  formatTalkSummaryMessage,
} from "../services/talk.service";
import { ensureUserByTelegramId } from "../services/user.service";
import { safeReply } from "../utils/telegram";

export const talkCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  const talkToken = process.env.BOT_TOKEN_TALK?.trim();
  if (!talkToken) {
    await safeReply(ctx, "Не задан BOT_TOKEN_TALK. Укажи токен второго бота.");
    return;
  }

  const talkBot = new Bot(talkToken);
  await safeReply(ctx, "Готовлю talk-сводки по последним новостям тем и отправлю их через talk-бота...");
  const user = await ensureUserByTelegramId(tgUserId);

  const syncResult = await syncFromTickTickToDb(user.id);
  try {
    if (!syncResult.ok) {
      await talkBot.api.sendMessage(
        Number(user.tgUserId),
        `Не удалось обновить задачи из TickTick. Продолжаю по локальной базе.\n${syncResult.authHint ?? "Проверь настройки TickTick API."}`
      );
    }

    const summaries = await buildTalkTopicSummariesForUser(user.id);
    if (!summaries.length) {
      await talkBot.api.sendMessage(Number(user.tgUserId), "Не нашел задач с маркерами talk/толк.");
      return;
    }

    await talkBot.api.sendMessage(Number(user.tgUserId), "Talk-сводка по отмеченным темам:");
    for (let i = 0; i < summaries.length; i += 1) {
      const summary = summaries[i];
      await talkBot.api.sendMessage(Number(user.tgUserId), formatTalkSummaryMessage(summary, i, summaries.length));
      const closeResult = await closeTalkTopicTasksAfterSummary(user.id, summary.taskRefs);
      console.log("[Talk] Manual close after summary", {
        userId: user.id,
        topic: summary.topic,
        closeResult,
      });
      if (closeResult.failed > 0) {
        await talkBot.api.sendMessage(
          Number(user.tgUserId),
          `Тема "${summary.topic}": часть задач не закрылась в TickTick (${closeResult.closed}/${closeResult.attempted}).`
        );
      }
    }

    await safeReply(ctx, "Сводка отправлена через BOT_TOKEN_TALK.");
  } catch (error: unknown) {
    console.error("[Talk] Failed to send via BOT_TOKEN_TALK", {
      userId: user.id,
      error,
    });
    await safeReply(
      ctx,
      "Не удалось отправить сводку через talk-бота. Проверь BOT_TOKEN_TALK и нажми /start в этом боте."
    );
  }
};
