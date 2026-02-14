import type { Project } from "@prisma/client";
import type { BotContext } from "../types/bot-context.types";
import { getProjectByNameOrId } from "../services/project.service";
import { safeReply } from "../utils/telegram";

const formatAmbiguousProjects = (
  projects: Array<Pick<Project, "id" | "name" | "status">>
): string => {
  const lines = projects.map((p) => `- ${p.name} [${p.status}] id=${p.id}`);
  return ["Найдено несколько проектов. Укажи точнее имя или id:", ...lines].join("\n");
};

export const resolveProjectOrReply = async (
  ctx: BotContext,
  userId: string,
  input: string
): Promise<Project | null> => {
  const resolved = await getProjectByNameOrId(userId, input);
  if (resolved.project) {
    return resolved.project;
  }

  if (resolved.ambiguous.length) {
    await safeReply(ctx, formatAmbiguousProjects(resolved.ambiguous));
    return null;
  }

  await safeReply(ctx, "Проект не найден. Проверь имя/id или используй /project_list");
  return null;
};
