import type { Context } from "grammy";
import { TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ensureUserByTelegramId } from "../services/user.service";
import { getOpenTasksForUser } from "../services/task-sync.service";
import { syncFromTickTickToDb } from "../services/sync-orchestrator.service";
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
  const syncResult = await syncFromTickTickToDb(user.id);
  if (!syncResult.ok) {
    console.error("[Bot] /tasks sync failed", {
      userId: user.id,
      authHint: syncResult.authHint,
    });
    await safeReply(
      ctx,
      `Не удалось синхронизировать задачи из TickTick.\n${syncResult.authHint ?? "Проверьте настройки TickTick API."}`
    );
    return;
  }

  console.log(`[Bot] /tasks sync success user=${user.id} tasksCount=${syncResult.tasksCount}`);

  try {
    const [openCount, doneCount, deletedCount, lastSync] = await Promise.all([
      prisma.task.count({ where: { userId: user.id, status: TaskStatus.OPEN } }),
      prisma.task.count({ where: { userId: user.id, status: TaskStatus.DONE } }),
      prisma.task.count({ where: { userId: user.id, status: TaskStatus.DELETED } }),
      prisma.userRule.findUnique({
        where: { key: `ticktick_last_sync:${user.id}` },
        select: { value: true },
      }),
    ]);
    console.log(
      `[Bot] /tasks debug user=${user.id} open=${openCount} done=${doneCount} deleted=${deletedCount}`
    );
    if (lastSync?.value) {
      console.log("[Bot] /tasks last sync meta:", lastSync.value);
    } else {
      console.log("[Bot] /tasks last sync meta not found");
    }
  } catch (error: unknown) {
    console.error("[Bot] /tasks debug counters failed", error);
  }

  const tasks = await getOpenTasksForUser(user.id);
  if (!tasks.length) {
    console.log(`[Bot] /tasks no active tasks in DB for user=${user.id}`);
  } else {
    const preview = tasks.slice(0, 5).map((task) => ({
      id: task.id,
      externalId: task.externalId,
      title: task.title,
      project: task.projectName,
      createdAt: task.createdAt.toISOString(),
    }));
    console.log("[Bot] /tasks active tasks preview:", preview);
  }

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
