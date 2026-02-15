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
  const startedAt = Date.now();
  console.log("[SyncOrchestrator] syncFromTickTickToDb started", { userId });
  const authHint = getTickTickAuthSetupHint();
  if (authHint) {
    console.error("[SyncOrchestrator] auth setup invalid", { userId, authHint });
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
  console.log("[SyncOrchestrator] syncFromTickTickToDb finished", {
    userId,
    tasksCount: tasks.length,
    elapsedMs: Date.now() - startedAt,
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
  const startedAt = Date.now();
  console.log("[SyncOrchestrator] syncFromTickTickToAllUsers started");
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
    console.error("[SyncOrchestrator] auth setup invalid for all users", {
      authHint,
      usersCount: users.length,
    });
    return {
      ok: false,
      usersSynced: 0,
      tasksCount: 0,
      authHint,
    };
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  console.log("[SyncOrchestrator] users loaded for sync", { usersCount: users.length });
  if (!users.length) {
    return {
      ok: true,
      usersSynced: 0,
      tasksCount: 0,
      authHint: null,
    };
  }

  const tasks = await getActiveTasks();
  console.log("[SyncOrchestrator] active tasks fetched from TickTick", { tasksCount: tasks.length });
  let syncedUsers = 0;
  let failedUsers = 0;
  for (const user of users) {
    try {
      await syncTickTickTasksToDb(user.id, tasks);
      await saveLastSyncMeta({
        userId: user.id,
        ok: true,
        tasksCount: tasks.length,
        message: "syncFromTickTickToAllUsers",
      });
      syncedUsers += 1;
    } catch (error: unknown) {
      failedUsers += 1;
      console.error("[SyncOrchestrator] per-user sync failed", { userId: user.id, error });
      await saveLastSyncMeta({
        userId: user.id,
        ok: false,
        tasksCount: 0,
        message: `sync failed: ${(error as Error).message ?? "unknown error"}`,
      });
    }
  }

  console.log("[SyncOrchestrator] syncFromTickTickToAllUsers finished", {
    usersCount: users.length,
    syncedUsers,
    failedUsers,
    tasksCount: tasks.length,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    ok: true,
    usersSynced: syncedUsers,
    tasksCount: tasks.length,
    authHint: null,
  };
};
