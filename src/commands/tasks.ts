import type { Context } from "grammy";
import { ensureUserByTelegramId } from "../services/user.service";
import { getOpenTasksForUser } from "../services/task-sync.service";
import { formatTasksByProjectMessages } from "../utils/formatter";
import { safeReply } from "../utils/telegram";

export const tasksCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  console.log(`[Bot] /tasks requested by user ${tgUserId}`);
  await safeReply(ctx, "Собираю информацию");

  const user = await ensureUserByTelegramId(tgUserId);
  const tasks = await getOpenTasksForUser(user.id);
  const taskMessages = formatTasksByProjectMessages(
    tasks.map((task) => ({
      id: task.externalId ?? task.id,
      title: task.title,
      projectId: task.projectId ?? undefined,
      projectName: task.projectName ?? undefined,
      createdDate: task.createdAt.toISOString(),
      dueDate: task.dueAt?.toISOString(),
      status: task.status === "OPEN" ? 0 : 2,
      priority: 0,
    }))
  );

  for (const message of taskMessages) {
    await safeReply(ctx, message);
  }
};
