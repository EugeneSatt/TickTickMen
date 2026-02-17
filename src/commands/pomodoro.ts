import type { BotContext } from "../types/bot-context.types";
import { ensureUserByTelegramId } from "../services/user.service";
import { stopPomodoroForToday } from "../services/pomodoro.service";
import { safeReply } from "../utils/telegram";

export const pomodoroStopCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || data !== "pomodoro:stop") {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  const user = await ensureUserByTelegramId(tgUserId);
  await stopPomodoroForToday({ id: user.id, timezone: user.timezone });
  await ctx.answerCallbackQuery({ text: "Остановил на сегодня" });
  await safeReply(ctx, "Ок, сегодня больше не присылаю напоминания про помодоро.");
};

