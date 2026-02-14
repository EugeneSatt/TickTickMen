import { InlineKeyboard } from "grammy";
import { Prisma, TaskSource, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { completeTask, getActiveTasks } from "../services/ticktick.service";
import { ensureUserByTelegramId } from "../services/user.service";
import type { BotContext } from "../types/bot-context.types";
import { safeReply } from "../utils/telegram";

const PENDING_KEY_PREFIX = "task_done_pending:";

interface PendingTaskDone {
  taskId: string;
  projectId: string;
  title: string;
}

const pendingKey = (userId: string): string => `${PENDING_KEY_PREFIX}${userId}`;

const setPendingTasks = async (userId: string, tasks: PendingTaskDone[]) => {
  await prisma.userRule.upsert({
    where: { key: pendingKey(userId) },
    update: {
      userId,
      isActive: true,
      value: ({
        tasks,
        createdAt: new Date().toISOString(),
      } as unknown) as Prisma.InputJsonValue,
    },
    create: {
      key: pendingKey(userId),
      userId,
      isActive: true,
      value: ({
        tasks,
        createdAt: new Date().toISOString(),
      } as unknown) as Prisma.InputJsonValue,
    },
  });
};

const getPendingTasks = async (userId: string): Promise<PendingTaskDone[]> => {
  const rule = await prisma.userRule.findUnique({
    where: { key: pendingKey(userId) },
    select: { value: true, isActive: true },
  });
  if (!rule?.isActive) {
    return [];
  }

  const value = rule.value as { tasks?: PendingTaskDone[] };
  if (!Array.isArray(value.tasks)) {
    return [];
  }
  return value.tasks.filter((task) => task.taskId && task.projectId && task.title);
};

const savePendingTasks = async (userId: string, tasks: PendingTaskDone[]) => {
  if (!tasks.length) {
    await prisma.userRule.upsert({
      where: { key: pendingKey(userId) },
      update: {
        userId,
        isActive: false,
        value: { tasks: [], createdAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
      create: {
        key: pendingKey(userId),
        userId,
        isActive: false,
        value: { tasks: [], createdAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });
    return;
  }

  await setPendingTasks(userId, tasks);
};

const buildKeyboard = (tasks: PendingTaskDone[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  for (const task of tasks.slice(0, 30)) {
    const label = task.title.length > 50 ? `${task.title.slice(0, 47)}...` : task.title;
    keyboard.text(label, `task_done:${task.taskId}`).row();
  }
  return keyboard;
};

export const taskDoneCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await ensureUserByTelegramId(tgUserId);

  const tasks = await getActiveTasks();
  const closable = tasks
    .filter((task) => task.status !== 2 && task.projectId && task.id && task.title)
    .map((task) => ({
      taskId: task.id,
      projectId: task.projectId as string,
      title: task.title,
    }));

  if (!closable.length) {
    await safeReply(ctx, "Нет активных задач для закрытия");
    return;
  }

  await setPendingTasks(user.id, closable);
  await ctx.reply("Выбери задачу для закрытия:", {
    reply_markup: buildKeyboard(closable),
  });
};

export const taskDoneCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("task_done:")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const user = await ensureUserByTelegramId(tgUserId);
  const taskId = data.replace("task_done:", "").trim();

  const pending = await getPendingTasks(user.id);
  const item = pending.find((task) => task.taskId === taskId);
  if (!item) {
    await ctx.answerCallbackQuery({ text: "Список устарел. Запусти /task_done снова" });
    return;
  }

  const result = await completeTask({ projectId: item.projectId, taskId: item.taskId });
  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: "Ошибка закрытия" });
    await safeReply(ctx, `⚠️ ${result.message ?? "Не удалось закрыть задачу в TickTick"}`);
    return;
  }

  const now = new Date();
  const updated = await prisma.task.updateMany({
    where: {
      userId: user.id,
      source: TaskSource.TICKTICK,
      externalId: item.taskId,
      status: TaskStatus.OPEN,
    },
    data: {
      status: TaskStatus.DONE,
      completedAt: now,
      lastSeenAt: now,
    },
  });

  if (updated.count > 0) {
    const tasksInDb = await prisma.task.findMany({
      where: {
        userId: user.id,
        source: TaskSource.TICKTICK,
        externalId: item.taskId,
      },
      select: { id: true },
    });

    if (tasksInDb.length) {
      await prisma.taskEvent.createMany({
        data: tasksInDb.map((task) => ({
          userId: user.id,
          taskId: task.id,
          type: "MANUAL_COMPLETE_FROM_TELEGRAM",
          at: now,
          fromStatus: TaskStatus.OPEN,
          toStatus: TaskStatus.DONE,
          meta: {
            source: "TELEGRAM",
          },
        })),
      });
    }
  }

  const remaining = pending.filter((task) => task.taskId !== item.taskId);
  await savePendingTasks(user.id, remaining);

  await ctx.answerCallbackQuery({ text: "Закрыто" });
  await safeReply(ctx, `✅ Закрыл: ${item.title}`);
};
