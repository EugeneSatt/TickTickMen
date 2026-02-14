import type { BotContext } from "../types/bot-context.types";
import { listProjects, upsertUserByTelegramId } from "../services/project.service";
import { safeReply } from "../utils/telegram";

export const projectListCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);
  const projects = await listProjects(user.id);

  if (!projects.length) {
    await safeReply(ctx, "📭 Проектов пока нет. Используй /project_new");
    return;
  }

  const isInboxProject = (name: string): boolean => {
    const normalized = name.trim().toLowerCase();
    return normalized === "входящие" || normalized === "inbox";
  };

  const lines = projects.map((project) => {
    const focused = project.weeklyFocus || isInboxProject(project.name);
    const focus = focused ? "⭐" : "▫️";
    return `${focus} ${project.name}`;
  });

  await safeReply(ctx, ["🗂️ Проекты:", ...lines].join("\n"));
};
