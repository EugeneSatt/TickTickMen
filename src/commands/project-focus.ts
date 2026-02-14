import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types/bot-context.types";
import { listProjects, setWeeklyFocus, upsertUserByTelegramId } from "../services/project.service";
import { safeReply } from "../utils/telegram";

export const projectFocusCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);
  const projects = await listProjects(user.id);
  if (!projects.length) {
    await safeReply(ctx, "📭 Нет проектов. Сначала создай: /project_new");
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const project of projects) {
    const mark = project.weeklyFocus ? "⭐ " : "";
    keyboard.text(`${mark}${project.name}`, `project_focus:set:${project.id}`).row();
  }

  await ctx.reply("Выбери фокусный проект:", { reply_markup: keyboard });
};

export const projectFocusCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("project_focus:set:")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const projectId = data.replace("project_focus:set:", "").trim();
  if (!projectId) {
    await ctx.answerCallbackQuery({ text: "Некорректный проект" });
    return;
  }

  const user = await upsertUserByTelegramId(tgUserId);
  const projects = await listProjects(user.id);
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    await ctx.answerCallbackQuery({ text: "Проект не найден" });
    await safeReply(ctx, "⚠️ Проект не найден");
    return;
  }

  await setWeeklyFocus(user.id, project.id);
  await ctx.answerCallbackQuery({ text: `Фокус: ${project.name}` });
  await safeReply(ctx, `⭐ Фокус недели установлен: ${project.name}`);
};
