import { TaskCategory, TaskStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { moodToInt } from "../types/domain.types";

const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

const avg = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const recomputeDailyFeatures = async (userId: string, day: DateTime) => {
  const dayStart = day.startOf("day");
  const dayEnd = day.endOf("day");

  const [tasksAdded, tasksDone, tasksOpen, overdueOpen, doneToday, morningCheckIn, eveningCheckIn] =
    await Promise.all([
      prisma.task.count({
        where: {
          userId,
          createdAt: { gte: dayStart.toJSDate(), lte: dayEnd.toJSDate() },
        },
      }),
      prisma.task.count({
        where: {
          userId,
          status: TaskStatus.DONE,
          completedAt: { gte: dayStart.toJSDate(), lte: dayEnd.toJSDate() },
        },
      }),
      prisma.task.count({ where: { userId, status: TaskStatus.OPEN } }),
      prisma.task.count({
        where: {
          userId,
          status: TaskStatus.OPEN,
          dueAt: { lt: dayStart.toJSDate() },
        },
      }),
      prisma.task.findMany({
        where: {
          userId,
          status: TaskStatus.DONE,
          completedAt: { gte: dayStart.toJSDate(), lte: dayEnd.toJSDate() },
        },
        select: {
          category: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.dailyCheckIn.findUnique({
        where: {
          userId_day_isMorning: {
            userId,
            day: dayStart.toJSDate(),
            isMorning: true,
          },
        },
      }),
      prisma.dailyCheckIn.findUnique({
        where: {
          userId_day_isMorning: {
            userId,
            day: dayStart.toJSDate(),
            isMorning: false,
          },
        },
      }),
    ]);

  const openTasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN },
    select: { createdAt: true },
  });

  const doneGrowth = doneToday.filter((task) => task.category === TaskCategory.GROWTH).length;
  const doneMoney = doneToday.filter((task) => task.category === TaskCategory.MONEY).length;
  const doneSystem = doneToday.filter((task) => task.category === TaskCategory.SYSTEM).length;
  const doneLife = doneToday.filter((task) => task.category === TaskCategory.LIFE).length;

  const avgTaskAgeDays = avg(
    openTasks.map((task) => dayEnd.diff(DateTime.fromJSDate(task.createdAt), "days").days)
  );

  const avgDoneTimeDays = avg(
    doneToday
      .filter((task) => task.completedAt)
      .map((task) =>
        DateTime.fromJSDate(task.completedAt as Date).diff(DateTime.fromJSDate(task.createdAt), "days")
          .days
      )
  );

  const doneTotal = doneGrowth + doneMoney + doneSystem + doneLife;
  const closureRate = safeDiv(tasksDone, Math.max(tasksOpen + tasksDone, 1));

  const burnoutFlag =
    (morningCheckIn?.energy ?? 3) <= 2 || (eveningCheckIn?.energy ?? morningCheckIn?.energy ?? 3) <= 2;
  const frictionFlag = overdueOpen > 0 || closureRate < 0.2;

  return prisma.dailyFeatures.upsert({
    where: {
      userId_day: {
        userId,
        day: dayStart.toJSDate(),
      },
    },
    update: {
      tasksAdded,
      tasksDone,
      tasksOpen,
      overdueOpen,
      doneGrowth,
      doneMoney,
      doneSystem,
      doneLife,
      shareGrowth: safeDiv(doneGrowth, doneTotal),
      shareMoney: safeDiv(doneMoney, doneTotal),
      shareSystem: safeDiv(doneSystem, doneTotal),
      shareLife: safeDiv(doneLife, doneTotal),
      closureRate,
      avgTaskAgeDays,
      avgDoneTimeDays,
      morningEnergy: morningCheckIn?.energy,
      morningFocus: morningCheckIn?.focus,
      morningMoodInt: morningCheckIn?.mood ? moodToInt(morningCheckIn.mood) : null,
      eveningEnergy: eveningCheckIn?.energy,
      eveningMoodInt: eveningCheckIn?.mood ? moodToInt(eveningCheckIn.mood) : null,
      burnoutFlag,
      frictionFlag,
      notes: {
        recomputedAt: new Date().toISOString(),
      },
    },
    create: {
      userId,
      day: dayStart.toJSDate(),
      tasksAdded,
      tasksDone,
      tasksOpen,
      overdueOpen,
      doneGrowth,
      doneMoney,
      doneSystem,
      doneLife,
      shareGrowth: safeDiv(doneGrowth, doneTotal),
      shareMoney: safeDiv(doneMoney, doneTotal),
      shareSystem: safeDiv(doneSystem, doneTotal),
      shareLife: safeDiv(doneLife, doneTotal),
      closureRate,
      avgTaskAgeDays,
      avgDoneTimeDays,
      morningEnergy: morningCheckIn?.energy,
      morningFocus: morningCheckIn?.focus,
      morningMoodInt: morningCheckIn?.mood ? moodToInt(morningCheckIn.mood) : null,
      eveningEnergy: eveningCheckIn?.energy,
      eveningMoodInt: eveningCheckIn?.mood ? moodToInt(eveningCheckIn.mood) : null,
      burnoutFlag,
      frictionFlag,
      notes: {
        recomputedAt: new Date().toISOString(),
      },
    },
  });
};

export const getFeatures7dAggregate = async (userId: string, day: DateTime) => {
  const from = day.minus({ days: 6 }).startOf("day").toJSDate();
  const to = day.endOf("day").toJSDate();

  const rows = await prisma.dailyFeatures.findMany({
    where: {
      userId,
      day: { gte: from, lte: to },
    },
    orderBy: { day: "asc" },
  });

  if (!rows.length) {
    return {
      days: 0,
      tasksAdded: 0,
      tasksDone: 0,
      avgClosureRate: 0,
      avgTaskAgeDays: 0,
      overdueOpenAvg: 0,
      burnoutDays: 0,
      frictionDays: 0,
    };
  }

  const total = rows.reduce(
    (acc, row) => {
      acc.tasksAdded += row.tasksAdded;
      acc.tasksDone += row.tasksDone;
      acc.avgClosureRate += row.closureRate;
      acc.avgTaskAgeDays += row.avgTaskAgeDays;
      acc.overdueOpenAvg += row.overdueOpen;
      acc.burnoutDays += row.burnoutFlag ? 1 : 0;
      acc.frictionDays += row.frictionFlag ? 1 : 0;
      return acc;
    },
    {
      tasksAdded: 0,
      tasksDone: 0,
      avgClosureRate: 0,
      avgTaskAgeDays: 0,
      overdueOpenAvg: 0,
      burnoutDays: 0,
      frictionDays: 0,
    }
  );

  return {
    days: rows.length,
    tasksAdded: total.tasksAdded,
    tasksDone: total.tasksDone,
    avgClosureRate: total.avgClosureRate / rows.length,
    avgTaskAgeDays: total.avgTaskAgeDays / rows.length,
    overdueOpenAvg: total.overdueOpenAvg / rows.length,
    burnoutDays: total.burnoutDays,
    frictionDays: total.frictionDays,
  };
};
