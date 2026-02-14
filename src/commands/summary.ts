import type { Context } from "grammy";
import { ensureUserByTelegramId } from "../services/user.service";
import { runTextSummary } from "../services/planning.service";
import { safeReply } from "../utils/telegram";

export const summaryDailyCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  const user = await ensureUserByTelegramId(tgUserId);
  const text = await runTextSummary(user, "DAILY");
  await safeReply(ctx, text);
};

export const summaryWeeklyCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  const user = await ensureUserByTelegramId(tgUserId);
  const text = await runTextSummary(user, "WEEKLY");
  await safeReply(ctx, text);
};
