import type { Context } from "grammy";
import { ensureUserByTelegramId } from "../services/user.service";
import { applyPendingCategories } from "../services/planning.service";
import { safeReply } from "../utils/telegram";

export const applyCategoriesCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  const user = await ensureUserByTelegramId(tgUserId);
  const result = await applyPendingCategories(user.id);

  await safeReply(ctx, `✅ Применено категорий: ${result.applied}`);
};
