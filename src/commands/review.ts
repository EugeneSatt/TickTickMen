import type { Context } from "grammy";
import { ensureUserByTelegramId } from "../services/user.service";
import { runRollingWeeklyReview } from "../services/planning.service";
import { safeReply } from "../utils/telegram";

export const reviewCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  console.log(`[Bot] /review requested by user ${tgUserId}`);

  const user = await ensureUserByTelegramId(tgUserId);
  const text = await runRollingWeeklyReview(user);
  await safeReply(ctx, text);
};
