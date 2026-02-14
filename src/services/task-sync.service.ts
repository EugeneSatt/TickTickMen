import { DateTime } from "luxon";
import { ProjectStatus, TaskSource, TaskStatus, type Prisma } from "@prisma/client";
import type { TickTickTask } from "../types/task.types";
import { prisma } from "../db/prisma";

const parseDate = (value?: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const dt = DateTime.fromISO(value);
  if (!dt.isValid) {
    return null;
  }

  return dt.toJSDate();
};

const toTaskCreateData = (
  userId: string,
  incoming: TickTickTask,
  projectId: string | null
): Prisma.TaskCreateInput => ({
  user: { connect: { id: userId } },
  externalId: incoming.id,
  source: TaskSource.TICKTICK,
  title: incoming.title,
  note: null,
  projectName: incoming.projectName ?? null,
  tags: [],
  status: TaskStatus.OPEN,
  dueAt: parseDate(incoming.dueDate),
  createdAt: parseDate(incoming.createdDate) ?? new Date(),
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
  project: projectId ? { connect: { id: projectId } } : undefined,
});

export const syncTickTickTasksToDb = async (userId: string, tasks: TickTickTask[]) => {
  const now = new Date();

  const projectNameToId = new Map<string, string>();
  const uniqueProjectNames = Array.from(
    new Set(tasks.map((task) => task.projectName?.trim()).filter((name): name is string => !!name))
  );

  for (const name of uniqueProjectNames) {
    const project = await prisma.project.upsert({
      where: { userId_name: { userId, name } },
      update: {
        status: ProjectStatus.ACTIVE,
      },
      create: {
        userId,
        name,
        status: ProjectStatus.ACTIVE,
      },
      select: { id: true, name: true },
    });
    projectNameToId.set(project.name, project.id);
  }

  const touchedTaskIds: string[] = [];

  for (const incoming of tasks) {
    const existing = await prisma.task.findFirst({
      where: {
        userId,
        source: TaskSource.TICKTICK,
        externalId: incoming.id,
      },
      select: {
        id: true,
        status: true,
      },
    });

    const projectId = incoming.projectName ? projectNameToId.get(incoming.projectName) ?? null : null;

    if (!existing) {
      const created = await prisma.task.create({
        data: toTaskCreateData(userId, incoming, projectId),
        select: { id: true },
      });
      touchedTaskIds.push(created.id);
      await prisma.taskEvent.create({
        data: {
          userId,
          taskId: created.id,
          type: "SYNC_CREATE",
          at: now,
          toStatus: TaskStatus.OPEN,
          toDueAt: parseDate(incoming.dueDate),
          meta: {
            source: "TICKTICK_SYNC",
          },
        },
      });
      continue;
    }

    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: {
        title: incoming.title,
        projectName: incoming.projectName ?? null,
        projectId,
        dueAt: parseDate(incoming.dueDate),
        status: TaskStatus.OPEN,
        lastSeenAt: now,
      },
      select: { id: true },
    });
    touchedTaskIds.push(updated.id);

    if (existing.status !== TaskStatus.OPEN) {
      await prisma.taskEvent.create({
        data: {
          userId,
          taskId: updated.id,
          type: "SYNC_REOPEN",
          at: now,
          fromStatus: existing.status,
          toStatus: TaskStatus.OPEN,
        },
      });
    }
  }

  await prisma.task.updateMany({
    where: {
      userId,
      source: TaskSource.TICKTICK,
      status: TaskStatus.OPEN,
      id: { notIn: touchedTaskIds.length ? touchedTaskIds : ["__none__"] },
    },
    data: {
      status: TaskStatus.DELETED,
      lastSeenAt: now,
    },
  });

  if (touchedTaskIds.length) {
    await prisma.taskEvent.createMany({
      data: touchedTaskIds.map((taskId) => ({
        userId,
        taskId,
        type: "SYNC_SEEN",
        at: now,
      })),
    });
  }
};

export const getOpenTasksForUser = async (userId: string) => {
  return prisma.task.findMany({
    where: {
      userId,
      status: TaskStatus.OPEN,
    },
    orderBy: [{ projectName: "asc" }, { createdAt: "asc" }],
  });
};
