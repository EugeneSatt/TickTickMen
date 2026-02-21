import type { Context } from "grammy";
import { syncFromTickTickToDb } from "../services/sync-orchestrator.service";
import { ensureUserByTelegramId } from "../services/user.service";
import { runPlanAndStoreSuggestions } from "../services/planning.service";
import { buildPlanMessage } from "../utils/plan-message";
import { safeReply } from "../utils/telegram";

const toErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export const planCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  console.log(`[Bot] /plan requested by user ${tgUserId}`);
  await safeReply(ctx, "Собираю информацию");

  const user = await ensureUserByTelegramId(tgUserId);
  const syncResult = await syncFromTickTickToDb(user.id);
  if (!syncResult.ok) {
    await safeReply(ctx, `⚠️ Синхронизация TickTick не выполнена: ${syncResult.authHint}`);
    await safeReply(ctx, "План будет построен по последним данным из БД.");
  } else {
    console.log("[Bot] /plan ticktick sync completed", {
      userId: user.id,
      tasksCount: syncResult.tasksCount,
    });
  }

  let plan;
  try {
    plan = await runPlanAndStoreSuggestions(user);
  } catch (error: unknown) {
    const errorText = toErrorText(error);
    console.error("[Bot] /plan failed", { errorText, error });
    await safeReply(
      ctx,
      `⚠️ Не удалось построить план: ${errorText}`
    );
    return;
  }

  const message = await buildPlanMessage(user.id, plan);
  await safeReply(ctx, message);
};
