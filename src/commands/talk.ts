import type { Context } from "grammy";
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

  await safeReply(ctx, "Готовлю talk-сводки по задачам...");
  const user = await ensureUserByTelegramId(tgUserId);

  const syncResult = await syncFromTickTickToDb(user.id);
  if (!syncResult.ok) {
    await safeReply(
      ctx,
      `Не удалось обновить задачи из TickTick. Продолжаю по локальной базе.\n${syncResult.authHint ?? "Проверь настройки TickTick API."}`
    );
  }

  const summaries = await buildTalkTopicSummariesForUser(user.id);
  if (!summaries.length) {
    await safeReply(ctx, "Не нашел задач с маркерами talk/толк.");
    return;
  }

  for (let i = 0; i < summaries.length; i += 1) {
    const summary = summaries[i];
    await safeReply(ctx, formatTalkSummaryMessage(summary, i, summaries.length));
    const closeResult = await closeTalkTopicTasksAfterSummary(user.id, summary.taskRefs);
    console.log("[Talk] Manual close after summary", {
      userId: user.id,
      topic: summary.topic,
      closeResult,
    });
    if (closeResult.failed > 0) {
      await safeReply(
        ctx,
        `Тема "${summary.topic}": часть задач не закрылась в TickTick (${closeResult.closed}/${closeResult.attempted}).`
      );
    }
  }
};
