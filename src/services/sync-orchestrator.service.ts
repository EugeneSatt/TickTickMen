import { getActiveTasks, getTickTickAuthSetupHint } from "./ticktick.service";
import { syncTickTickTasksToDb } from "./task-sync.service";
import { prisma } from "../db/prisma";

export const syncFromTickTickToDb = async (userId: string) => {
  const authHint = getTickTickAuthSetupHint();
  if (authHint) {
    return {
      ok: false as const,
      authHint,
      tasksCount: 0,
    };
  }

  const tasks = await getActiveTasks();
  await syncTickTickTasksToDb(userId, tasks);

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
  }

  return {
    ok: true,
    usersSynced: users.length,
    tasksCount: tasks.length,
    authHint: null,
  };
};
