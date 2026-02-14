import type { BotContext } from "../types/bot-context.types";
import {
  getProjectWithRecentNotes,
  listProjects,
  upsertUserByTelegramId,
} from "../services/project.service";
import { formatProjectCard, parseCommandArgs } from "../utils/project";
import { safeReply } from "../utils/telegram";
import { resolveProjectOrReply } from "./project-common";

export const projectViewCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const args = parseCommandArgs(ctx.message?.text ?? "");
  const user = await upsertUserByTelegramId(tgUserId);
  let project = null;

  if (!args.length) {
    const projects = await listProjects(user.id);
    if (!projects.length) {
      await safeReply(ctx, "Проектов пока нет. Используй /project_new");
      return;
    }

    for (const currentProject of projects) {
      const withNotes = await getProjectWithRecentNotes(user.id, currentProject.id);
      if (!withNotes) {
        continue;
      }
      await safeReply(ctx, formatProjectCard(withNotes, withNotes.notes));
    }
    return;
  } else {
    project = await resolveProjectOrReply(ctx, user.id, args.join(" "));
  }

  if (!project) {
    return;
  }

  const withNotes = await getProjectWithRecentNotes(user.id, project.id);
  if (!withNotes) {
    await safeReply(ctx, "Проект не найден");
    return;
  }

  await safeReply(ctx, formatProjectCard(withNotes, withNotes.notes));
};
