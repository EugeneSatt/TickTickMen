import type { BotContext } from "../types/bot-context.types";
import { linkTaskToProject, upsertUserByTelegramId } from "../services/project.service";
import { parseCommandArgs } from "../utils/project";
import { safeReply } from "../utils/telegram";
import { resolveProjectOrReply } from "./project-common";

export const taskProjectCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const args = parseCommandArgs(ctx.message?.text ?? "");
  if (args.length < 2) {
    await safeReply(ctx, "Использование: /task_project <taskIdOrTitle> <projectNameOrId>");
    return;
  }

  const taskRef = args[0];
  const projectRef = args.slice(1).join(" ");

  const user = await upsertUserByTelegramId(tgUserId);
  const project = await resolveProjectOrReply(ctx, user.id, projectRef);
  if (!project) {
    return;
  }

  const linkedCount = await linkTaskToProject(user.id, taskRef, project.id);
  if (linkedCount === 0) {
    await safeReply(ctx, "Задача не найдена в локальной БД. Сначала выполни /tasks");
    return;
  }

  await safeReply(ctx, `✅ Связано задач: ${linkedCount}. Проект: ${project.name}`);
};
