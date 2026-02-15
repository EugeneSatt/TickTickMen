import { getActiveTasks, getTickTickAuthSetupHint } from "./ticktick.service";
import { syncTickTickTasksToDb } from "./task-sync.service";
import { prisma } from "../db/prisma";
import { Prisma } from "@prisma/client";

const lastSyncRuleKey = (userId: string) => `ticktick_last_sync:${userId}`;

const saveLastSyncMeta = async (params: {
  userId: string;
  ok: boolean;
  tasksCount: number;
  message: string;
}) => {
  await prisma.userRule.upsert({
    where: { key: lastSyncRuleKey(params.userId) },
    update: {
      userId: params.userId,
      isActive: true,
      value: ({
        ok: params.ok,
        tasksCount: params.tasksCount,
        message: params.message,
        syncedAt: new Date().toISOString(),
      } as unknown) as Prisma.InputJsonValue,
    },
    create: {
      key: lastSyncRuleKey(params.userId),
      userId: params.userId,
      isActive: true,
      value: ({
        ok: params.ok,
        tasksCount: params.tasksCount,
        message: params.message,
        syncedAt: new Date().toISOString(),
      } as unknown) as Prisma.InputJsonValue,
    },
  });
};

export const syncFromTickTickToDb = async (userId: string) => {
  const authHint = getTickTickAuthSetupHint();
  if (authHint) {
    await saveLastSyncMeta({
      userId,
      ok: false,
      tasksCount: 0,
      message: authHint,
    });
    return {
      ok: false as const,
      authHint,
      tasksCount: 0,
    };
  }

  const tasks = await getActiveTasks();
  await syncTickTickTasksToDb(userId, tasks);
  await saveLastSyncMeta({
    userId,
    ok: true,
    tasksCount: tasks.length,
    message: "syncFromTickTickToDb",
  });

  return {
    ok: true as const,
    authHint: null,
    tasksCount: tasks.length,
  };
};

export const syncFromTickTickToAllUsers = async (): Promise<{
  ok: boolean;
  usersSynced: number;
  tasksCount: number;
  authHint: string | null;
}> => {
  const authHint = getTickTickAuthSetupHint();
  if (authHint) {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await saveLastSyncMeta({
        userId: user.id,
        ok: false,
        tasksCount: 0,
        message: authHint,
      });
    }
    return {
      ok: false,
      usersSynced: 0,
      tasksCount: 0,
      authHint,
    };
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  if (!users.length) {
    return {
      ok: true,
      usersSynced: 0,
      tasksCount: 0,
      authHint: null,
    };
  }

  const tasks = await getActiveTasks();
  for (const user of users) {
    await syncTickTickTasksToDb(user.id, tasks);
    await saveLastSyncMeta({
      userId: user.id,
      ok: true,
      tasksCount: tasks.length,
      message: "syncFromTickTickToAllUsers",
    });
  }

  return {
    ok: true,
    usersSynced: users.length,
    tasksCount: tasks.length,
    authHint: null,
  };
};
