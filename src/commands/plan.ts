import type { Context } from "grammy";
import { ensureUserByTelegramId } from "../services/user.service";
import { runPlanAndStoreSuggestions } from "../services/planning.service";
import { buildPlanMessage } from "../utils/plan-message";
import { safeReply } from "../utils/telegram";

export const planCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  console.log(`[Bot] /plan requested by user ${tgUserId}`);
  await safeReply(ctx, "Собираю информацию");

  const user = await ensureUserByTelegramId(tgUserId);
  let plan;
  try {
    plan = await runPlanAndStoreSuggestions(user);
  } catch (error: unknown) {
    console.error("[Bot] /plan failed", error);
    await safeReply(
      ctx,
      "⚠️ Не удалось построить план. Проверь COMET_API_KEY/COMET_MODEL и повтори позже."
    );
    return;
  }

  const message = await buildPlanMessage(user.id, plan);
  await safeReply(ctx, message);
};
