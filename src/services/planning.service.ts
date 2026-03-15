import { DateTime } from "luxon";
import {
  Prisma,
  TaskCategory,
  TaskSource,
  TaskStatus,
  type DailyCheckIn,
  type User,
} from "@prisma/client";
import type { Bot } from "grammy";
import { prisma } from "../db/prisma";
import type {
  BehaviorPatterns7d,
  PlanInput,
  PlanOutput,
  WeeklyReviewInput,
} from "../types/llm.types";
import { moodToInt } from "../types/domain.types";
import { getAgentModeForUser } from "./agent-mode.service";
import { getFeatures7dAggregate, recomputeDailyFeatures } from "./features.service";
import {
  generatePlan,
  generateReview,
  generateTextSummary,
  generateWeeklyReviewAnalysis,
} from "./comet-llm.service";

const PLAN_SUGGESTIONS_RULE_PREFIX = "plan_category_suggestions:";
const DAILY_PLAN_SNAPSHOT_RULE_PREFIX = "daily_plan_snapshot:";
const TALK_PHRASE_MARKERS = ["/talk", "/толк", "slash talk", "слеш толк"];

const truncate = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

interface StoredPlanFocusItem {
  taskId: string;
  title: string;
  project: string;
  category: string;
  reason: string;
}

interface StoredPlanFallbackItem {
  forTaskId: string;
  title: string;
  alternativeAction: string;
  reason: string;
}

interface DailyPlanSnapshotValue {
  day: string;
  generatedAt: string;
  today: PlanInput["today"];
  focus: StoredPlanFocusItem[];
  fallbackOptions: StoredPlanFallbackItem[];
  doNotDo: string;
  riskOfTheDay: string;
  warnings: string[];
  strategyNote: string;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeTaskCategory = (value: unknown): string => {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }
  if (["MONEY", "GROWTH", "SYSTEM", "LIFE", "UNKNOWN"].includes(value)) {
    return value;
  }
  return "UNKNOWN";
};

const isReminderProject = (projectName: string | null): boolean => {
  const normalized = projectName?.trim().toLowerCase() ?? "";
  return (
    normalized === "напоминания" ||
    normalized === "reminders" ||
    normalized === "reminder"
  );
};

const isTalkLikeTask = (title: string): boolean => {
  const normalized = title.trim().toLowerCase();
  return TALK_PHRASE_MARKERS.some((marker) => normalized.includes(marker));
};

const shouldCountInBehavior = (task: { title: string; projectName: string | null }): boolean =>
  !isTalkLikeTask(task.title) && !isReminderProject(task.projectName);

const dailyPlanSnapshotRuleKey = (userId: string, dayKey: string): string =>
  `${DAILY_PLAN_SNAPSHOT_RULE_PREFIX}${userId}:${dayKey}`;

const parseDailyPlanSnapshot = (value: Prisma.JsonValue): DailyPlanSnapshotValue | null => {
  if (!isObjectRecord(value)) {
    return null;
  }

  const focus = Array.isArray(value.focus)
    ? value.focus
        .map((item) => {
          if (!isObjectRecord(item)) {
            return null;
          }
          const taskId = typeof item.taskId === "string" ? item.taskId : "";
          const title = typeof item.title === "string" ? item.title : "";
          if (!taskId || !title) {
            return null;
          }
          return {
            taskId,
            title,
            project: typeof item.project === "string" ? item.project : "Без проекта",
            category: normalizeTaskCategory(item.category),
            reason: typeof item.reason === "string" ? item.reason : "",
          };
        })
        .filter((item): item is StoredPlanFocusItem => item !== null)
    : [];

  const fallbackOptions = Array.isArray(value.fallbackOptions)
    ? value.fallbackOptions
        .map((item) => {
          if (!isObjectRecord(item)) {
            return null;
          }
          const forTaskId = typeof item.forTaskId === "string" ? item.forTaskId : "";
          const alternativeAction =
            typeof item.alternativeAction === "string" ? item.alternativeAction : "";
          if (!forTaskId || !alternativeAction) {
            return null;
          }
          return {
            forTaskId,
            title: typeof item.title === "string" ? item.title : "",
            alternativeAction,
            reason: typeof item.reason === "string" ? item.reason : "",
          };
        })
        .filter((item): item is StoredPlanFallbackItem => item !== null)
    : [];

  const today = isObjectRecord(value.today)
    ? {
        day: typeof value.today.day === "string" ? value.today.day : "",
        energy: typeof value.today.energy === "number" ? value.today.energy : 3,
        focus: typeof value.today.focus === "number" ? value.today.focus : 3,
        mood: typeof value.today.mood === "number" ? value.today.mood : 0,
        note: typeof value.today.note === "string" ? value.today.note : "",
        yesterdayEvening: isObjectRecord(value.today.yesterdayEvening)
          ? {
              energy:
                typeof value.today.yesterdayEvening.energy === "number"
                  ? value.today.yesterdayEvening.energy
                  : null,
              mood:
                typeof value.today.yesterdayEvening.mood === "number"
                  ? value.today.yesterdayEvening.mood
                  : null,
              note:
                typeof value.today.yesterdayEvening.note === "string"
                  ? value.today.yesterdayEvening.note
                  : "",
            }
          : null,
      }
    : null;

  if (!today?.day) {
    return null;
  }

  return {
    day: typeof value.day === "string" ? value.day : today.day,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    today,
    focus,
    fallbackOptions,
    doNotDo: typeof value.doNotDo === "string" ? value.doNotDo : "",
    riskOfTheDay: typeof value.riskOfTheDay === "string" ? value.riskOfTheDay : "",
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((item): item is string => typeof item === "string")
      : [],
    strategyNote: typeof value.strategyNote === "string" ? value.strategyNote : "",
  };
};

const buildBehaviorInsights = (patterns: BehaviorPatterns7d): string[] => {
  const insights: string[] = [];

  if (patterns.plannedDays === 0) {
    insights.push("Недостаточно истории дневных планов: устойчивый паттерн еще не сформирован.");
    return insights;
  }

  if (
    patterns.followThroughRate < 0.35 &&
    patterns.completedOutsidePlanSameDay > patterns.focusTasksCompletedSameDay
  ) {
    insights.push("Чаще закрывает задачи вне предложенного дневного фокуса, чем сами фокус-задачи.");
  }

  if (patterns.daysWithOnlyOutsidePlanDone >= 2) {
    insights.push("Есть несколько дней, где выполнены только внеплановые задачи.");
  }

  const dominantOutsideCategory = Object.entries(patterns.topOutsidePlanCategories).sort(
    (a, b) => b[1] - a[1]
  )[0];
  if (dominantOutsideCategory && dominantOutsideCategory[1] >= 2) {
    insights.push(`Вне плана чаще всего закрываются задачи категории ${dominantOutsideCategory[0]}.`);
  }

  if (patterns.topOutsidePlanProjects[0]?.count >= 2) {
    insights.push(
      `Вне плана часто выбираются задачи проекта "${patterns.topOutsidePlanProjects[0].project}".`
    );
  }

  if (patterns.followThroughRate >= 0.6 && patterns.plannedDays >= 2) {
    insights.push("Обычно следует дневному фокусу, можно держать более жесткий приоритет.");
  }

  return insights;
};

const toPlanTask = (task: {
  id: string;
  title: string;
  projectName: string | null;
  dueAt: Date | null;
  category: TaskCategory;
  createdAt: Date;
}) => {
  const ageDays = Math.max(0, DateTime.now().diff(DateTime.fromJSDate(task.createdAt), "days").days);

  return {
    id: task.id,
    title: task.title,
    project: task.projectName ?? "Без проекта",
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    category: task.category,
    ageDays: Number(ageDays.toFixed(2)),
  };
};

const getMorningCheckIn = async (userId: string, day: DateTime): Promise<DailyCheckIn | null> => {
  return prisma.dailyCheckIn.findUnique({
    where: {
      userId_day_isMorning: {
        userId,
        day: day.startOf("day").toJSDate(),
        isMorning: true,
      },
    },
  });
};

const getEveningCheckIn = async (userId: string, day: DateTime): Promise<DailyCheckIn | null> => {
  return prisma.dailyCheckIn.findUnique({
    where: {
      userId_day_isMorning: {
        userId,
        day: day.startOf("day").toJSDate(),
        isMorning: false,
      },
    },
  });
};

const getActiveFocusProject = async (userId: string) => {
  const inboxProject = await prisma.project.findFirst({
    where: {
      userId,
      OR: [
        { name: { contains: "входящ", mode: "insensitive" } },
        { name: { contains: "inbox", mode: "insensitive" } },
      ],
    },
    orderBy: [{ weeklyFocus: "desc" }, { updatedAt: "desc" }],
  });
  if (inboxProject) {
    return inboxProject;
  }

  const explicitFocus = await prisma.project.findFirst({
    where: {
      userId,
      weeklyFocus: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (explicitFocus) {
    return explicitFocus;
  }

  return prisma.project.findFirst({
    where: {
      userId,
      status: {
        in: ["ACTIVE", "PRE_LAUNCH"],
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
};

const getRulesMap = async (userId: string) => {
  const rules = await prisma.userRule.findMany({
    where: {
      userId,
      isActive: true,
    },
    orderBy: { key: "asc" },
  });

  return rules.reduce<Record<string, unknown>>((acc, rule) => {
    acc[rule.key] = rule.value;
    return acc;
  }, {});
};

const buildBehaviorPatternsForPeriod = async (
  user: User,
  from: DateTime,
  to: DateTime
): Promise<BehaviorPatterns7d> => {
  const fromDay = from.startOf("day");
  const toDay = to.endOf("day");
  const fromKey = fromDay.toFormat("yyyy-LL-dd");
  const toKey = toDay.toFormat("yyyy-LL-dd");

  const [snapshotRules, completedTasks] = await Promise.all([
    prisma.userRule.findMany({
      where: {
        userId: user.id,
        isActive: true,
        key: { startsWith: `${DAILY_PLAN_SNAPSHOT_RULE_PREFIX}${user.id}:` },
      },
      select: { value: true },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: TaskStatus.DONE,
        completedAt: {
          gte: fromDay.toJSDate(),
          lte: toDay.toJSDate(),
        },
      },
      select: {
        id: true,
        title: true,
        projectName: true,
        category: true,
        completedAt: true,
        source: true,
      },
    }),
  ]);

  const snapshots = snapshotRules
    .map((rule) => parseDailyPlanSnapshot(rule.value))
    .filter((snapshot): snapshot is DailyPlanSnapshotValue => snapshot !== null)
    .filter((snapshot) => snapshot.day >= fromKey && snapshot.day <= toKey)
    .sort((left, right) => left.day.localeCompare(right.day));

  const completedByDay = new Map<
    string,
    Array<{
      id: string;
      title: string;
      projectName: string | null;
      category: TaskCategory;
      completedAt: Date;
    }>
  >();

  for (const task of completedTasks) {
    if (!task.completedAt || !shouldCountInBehavior(task)) {
      continue;
    }

    let completedAtLocal = DateTime.fromJSDate(task.completedAt).setZone(user.timezone);
    // Night TickTick sync marks missing tasks as done around 02:00, so attribute them to the previous day.
    if (task.source === TaskSource.TICKTICK && completedAtLocal.hour < 5) {
      completedAtLocal = completedAtLocal.minus({ days: 1 });
    }

    const dayKey = completedAtLocal.toFormat("yyyy-LL-dd");
    if (dayKey < fromKey || dayKey > toKey) {
      continue;
    }

    const bucket = completedByDay.get(dayKey) ?? [];
    bucket.push({
      id: task.id,
      title: task.title,
      projectName: task.projectName,
      category: task.category,
      completedAt: task.completedAt,
    });
    completedByDay.set(dayKey, bucket);
  }

  let focusTasksPlanned = 0;
  let focusTasksCompletedSameDay = 0;
  let completedOutsidePlanSameDay = 0;
  let daysWithAnyFocusDone = 0;
  let daysWithOnlyOutsidePlanDone = 0;

  const outsideProjectCounts = new Map<string, number>();
  const topOutsidePlanCategories: BehaviorPatterns7d["topOutsidePlanCategories"] = {
    MONEY: 0,
    GROWTH: 0,
    SYSTEM: 0,
    LIFE: 0,
    UNKNOWN: 0,
  };
  const recentOutsidePlanCompleted: Array<{
    title: string;
    project: string;
    category: string;
    completedAt: Date;
  }> = [];

  for (const snapshot of snapshots) {
    focusTasksPlanned += snapshot.focus.length;

    const doneForDay = completedByDay.get(snapshot.day) ?? [];
    const focusIds = new Set(snapshot.focus.map((item) => item.taskId));
    const completedFromFocus = doneForDay.filter((task) => focusIds.has(task.id));
    const completedOutsidePlan = doneForDay.filter((task) => !focusIds.has(task.id));

    focusTasksCompletedSameDay += completedFromFocus.length;
    completedOutsidePlanSameDay += completedOutsidePlan.length;

    if (completedFromFocus.length > 0) {
      daysWithAnyFocusDone += 1;
    }
    if (completedFromFocus.length === 0 && completedOutsidePlan.length > 0) {
      daysWithOnlyOutsidePlanDone += 1;
    }

    for (const task of completedOutsidePlan) {
      const project = task.projectName ?? "Без проекта";
      outsideProjectCounts.set(project, (outsideProjectCounts.get(project) ?? 0) + 1);
      topOutsidePlanCategories[task.category] += 1;
      recentOutsidePlanCompleted.push({
        title: task.title,
        project,
        category: task.category,
        completedAt: task.completedAt,
      });
    }
  }

  const totalCompletedOnPlannedDays = focusTasksCompletedSameDay + completedOutsidePlanSameDay;
  const patterns: BehaviorPatterns7d = {
    plannedDays: snapshots.length,
    focusTasksPlanned,
    focusTasksCompletedSameDay,
    completedOutsidePlanSameDay,
    followThroughRate:
      focusTasksPlanned > 0 ? Number((focusTasksCompletedSameDay / focusTasksPlanned).toFixed(2)) : 0,
    outsidePlanRate:
      totalCompletedOnPlannedDays > 0
        ? Number((completedOutsidePlanSameDay / totalCompletedOnPlannedDays).toFixed(2))
        : 0,
    daysWithAnyFocusDone,
    daysWithOnlyOutsidePlanDone,
    topOutsidePlanProjects: Array.from(outsideProjectCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([project, count]) => ({ project, count })),
    topOutsidePlanCategories,
    recentOutsidePlanCompleted: recentOutsidePlanCompleted
      .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime())
      .slice(0, 5)
      .map(({ completedAt: _completedAt, ...item }) => item),
    insights: [],
  };

  patterns.insights = buildBehaviorInsights(patterns);
  return patterns;
};

const storeDailyPlanSnapshot = async (
  user: User,
  input: PlanInput,
  output: PlanOutput
): Promise<DailyPlanSnapshotValue> => {
  const referencedTaskIds = Array.from(
    new Set([
      ...output.focus.map((item) => item.taskId).filter(Boolean),
      ...output.fallbackOptions.map((item) => item.forTaskId).filter(Boolean),
    ])
  );

  const relatedTasks = referencedTaskIds.length
    ? await prisma.task.findMany({
        where: {
          userId: user.id,
          id: { in: referencedTaskIds },
        },
        select: {
          id: true,
          title: true,
          projectName: true,
          category: true,
        },
      })
    : [];

  const taskById = new Map(relatedTasks.map((task) => [task.id, task]));

  const snapshot: DailyPlanSnapshotValue = {
    day: input.today.day,
    generatedAt: new Date().toISOString(),
    today: input.today,
    focus: output.focus.map((item) => {
      const task = taskById.get(item.taskId);
      return {
        taskId: item.taskId,
        title: task?.title ?? (item.reason || "Без названия"),
        project: task?.projectName ?? "Без проекта",
        category: task?.category ?? "UNKNOWN",
        reason: item.reason,
      };
    }),
    fallbackOptions: output.fallbackOptions.map((item) => {
      const task = taskById.get(item.forTaskId);
      return {
        forTaskId: item.forTaskId,
        title: task?.title ?? "",
        alternativeAction: item.alternativeAction,
        reason: item.reason,
      };
    }),
    doNotDo: output.doNotDo,
    riskOfTheDay: output.riskOfTheDay,
    warnings: output.warnings,
    strategyNote: output.strategyNote,
  };

  await prisma.userRule.upsert({
    where: { key: dailyPlanSnapshotRuleKey(user.id, input.today.day) },
    update: {
      userId: user.id,
      isActive: true,
      value: snapshot as unknown as Prisma.InputJsonValue,
    },
    create: {
      userId: user.id,
      key: dailyPlanSnapshotRuleKey(user.id, input.today.day),
      isActive: true,
      value: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  return snapshot;
};

const buildTasksStats7d = async (userId: string, day: DateTime) => {
  const from = day.minus({ days: 6 }).startOf("day").toJSDate();
  const to = day.endOf("day").toJSDate();

  const [done7d, openNow, overdueOpenNow] = await Promise.all([
    prisma.task.count({
      where: {
        userId,
        status: TaskStatus.DONE,
        completedAt: { gte: from, lte: to },
      },
    }),
    prisma.task.count({
      where: {
        userId,
        status: TaskStatus.OPEN,
      },
    }),
    prisma.task.count({
      where: {
        userId,
        status: TaskStatus.OPEN,
        dueAt: { lt: day.startOf("day").toJSDate() },
      },
    }),
  ]);

  return {
    done7d,
    openNow,
    overdueOpenNow,
    doneToOpenRatio: openNow > 0 ? Number((done7d / openNow).toFixed(2)) : done7d,
  };
};

const buildEmotionStats7d = async (userId: string, day: DateTime) => {
  const from = day.minus({ days: 6 }).startOf("day").toJSDate();
  const to = day.endOf("day").toJSDate();

  const checkins = await prisma.dailyCheckIn.findMany({
    where: {
      userId,
      day: { gte: from, lte: to },
    },
    select: {
      day: true,
      energy: true,
      focus: true,
      mood: true,
    },
    orderBy: { day: "asc" },
  });

  if (!checkins.length) {
    return {
      checkins: 0,
      avgEnergy: 0,
      avgFocus: 0,
      avgMood: 0,
      lowEnergyDays: 0,
      negativeMoodDays: 0,
    };
  }

  const avgEnergy = checkins.reduce((acc, item) => acc + item.energy, 0) / checkins.length;
  const avgFocus = checkins.reduce((acc, item) => acc + item.focus, 0) / checkins.length;
  const moods = checkins.map((item) => moodToInt(item.mood));
  const avgMood = moods.reduce((acc, value) => acc + value, 0) / moods.length;

  const lowEnergyDaysSet = new Set(
    checkins
      .filter((item) => item.energy <= 2)
      .map((item) => DateTime.fromJSDate(item.day).toFormat("yyyy-LL-dd"))
  );
  const negativeMoodDaysSet = new Set(
    checkins
      .filter((item) => moodToInt(item.mood) < 0)
      .map((item) => DateTime.fromJSDate(item.day).toFormat("yyyy-LL-dd"))
  );

  return {
    checkins: checkins.length,
    avgEnergy: Number(avgEnergy.toFixed(2)),
    avgFocus: Number(avgFocus.toFixed(2)),
    avgMood: Number(avgMood.toFixed(2)),
    lowEnergyDays: lowEnergyDaysSet.size,
    negativeMoodDays: negativeMoodDaysSet.size,
  };
};

export const buildPlanInput = async (user: User): Promise<PlanInput> => {
  const now = DateTime.now().setZone(user.timezone);
  const day = now.startOf("day");

  await recomputeDailyFeatures(user.id, day);

  const yesterday = day.minus({ days: 1 });

  const [agentMode, morningCheckIn, yesterdayEveningCheckIn, features7d, tasksStats7d, emotion7d, behaviorPatterns7d, activeTasks, focusProject, rules] = await Promise.all([
    getAgentModeForUser(user.id),
    getMorningCheckIn(user.id, day),
    getEveningCheckIn(user.id, yesterday),
    getFeatures7dAggregate(user.id, day),
    buildTasksStats7d(user.id, day),
    buildEmotionStats7d(user.id, day),
    buildBehaviorPatternsForPeriod(user, day.minus({ days: 6 }), day),
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: TaskStatus.OPEN,
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 15,
      select: {
        id: true,
        title: true,
        projectName: true,
        dueAt: true,
        category: true,
        createdAt: true,
      },
    }),
    getActiveFocusProject(user.id),
    getRulesMap(user.id),
  ]);

  return {
    agentMode,
    today: {
      day: day.toFormat("yyyy-LL-dd"),
      energy: morningCheckIn?.energy ?? 3,
      focus: morningCheckIn?.focus ?? 3,
      mood: morningCheckIn?.mood ? moodToInt(morningCheckIn.mood) : 0,
      note: morningCheckIn?.note ?? "",
      yesterdayEvening: yesterdayEveningCheckIn
        ? {
            energy: yesterdayEveningCheckIn.energy,
            mood: moodToInt(yesterdayEveningCheckIn.mood),
            note: yesterdayEveningCheckIn.note ?? "",
          }
        : null,
    },
    features7d,
    tasksStats7d,
    emotion7d,
    behaviorPatterns7d,
    activeTasks: activeTasks.map(toPlanTask),
    focusProject: focusProject
      ? {
          name: focusProject.name,
          status: focusProject.status,
          vision: focusProject.vision,
          metric: focusProject.metric,
          revenueGoal: focusProject.revenueGoal,
          riskLevel: focusProject.riskLevel,
          energyScore: focusProject.energyScore,
        }
      : null,
    rules,
  };
};

const suggestionsRuleKey = (userId: string) => `${PLAN_SUGGESTIONS_RULE_PREFIX}${userId}`;

export const runPlanAndStoreSuggestions = async (user: User): Promise<PlanOutput> => {
  const input = await buildPlanInput(user);
  const output = await generatePlan(input);
  const snapshot = await storeDailyPlanSnapshot(user, input, output);

  await prisma.userRule.upsert({
    where: { key: suggestionsRuleKey(user.id) },
    update: {
      value: output.categorySuggestions as Prisma.InputJsonValue,
      isActive: true,
      userId: user.id,
    },
    create: {
      userId: user.id,
      key: suggestionsRuleKey(user.id),
      value: output.categorySuggestions as Prisma.InputJsonValue,
      isActive: true,
    },
  });

  const text = truncate(
    [
      `Фокус: ${snapshot.focus.map((item) => item.title).join(", ") || "—"}`,
      `Не делать: ${output.doNotDo || "—"}`,
      `Риск дня: ${output.riskOfTheDay || "—"}`,
      `Предупреждения: ${output.warnings.join("; ") || "—"}`,
      `Стратегия: ${output.strategyNote || "—"}`,
    ].join("\n"),
    4000
  );

  await prisma.summary.create({
    data: {
      userId: user.id,
      period: "DAILY_PLAN",
      day: DateTime.now().setZone(user.timezone).startOf("day").toJSDate(),
      text,
    },
  });

  return output;
};

export const applyPendingCategories = async (userId: string) => {
  const rule = await prisma.userRule.findUnique({
    where: { key: suggestionsRuleKey(userId) },
  });

  if (!rule?.isActive || !Array.isArray(rule.value)) {
    return { applied: 0 };
  }

  let applied = 0;
  for (const raw of rule.value) {
    const item = raw as { taskId?: string; category?: string; confidence?: number };
    if (!item.taskId || !item.category) {
      continue;
    }
    if (!["GROWTH", "MONEY", "SYSTEM", "LIFE"].includes(item.category)) {
      continue;
    }

    await prisma.task.updateMany({
      where: {
        id: item.taskId,
        userId,
        status: TaskStatus.OPEN,
      },
      data: {
        category: item.category as TaskCategory,
      },
    });
    applied += 1;
  }

  await prisma.userRule.update({
    where: { key: suggestionsRuleKey(userId) },
    data: { isActive: false },
  });

  return { applied };
};

const buildReviewStats = async (params: {
  userId: string;
  from: DateTime;
  to: DateTime;
  now: DateTime;
}) => {
  const { userId, from, to, now } = params;
  const [tasksAdded, tasksDone, tasksOpenNow, overdueOpenNow, doneByCategory] = await Promise.all([
    prisma.task.count({
      where: {
        userId,
        createdAt: {
          gte: from.toJSDate(),
          lte: to.toJSDate(),
        },
      },
    }),
    prisma.task.count({
      where: {
        userId,
        status: TaskStatus.DONE,
        completedAt: {
          gte: from.toJSDate(),
          lte: to.toJSDate(),
        },
      },
    }),
    prisma.task.count({
      where: {
        userId,
        status: TaskStatus.OPEN,
      },
    }),
    prisma.task.count({
      where: {
        userId,
        status: TaskStatus.OPEN,
        dueAt: { lt: now.startOf("day").toJSDate() },
      },
    }),
    prisma.task.groupBy({
      by: ["category"],
      where: {
        userId,
        status: TaskStatus.DONE,
        completedAt: {
          gte: from.toJSDate(),
          lte: to.toJSDate(),
        },
      },
      _count: true,
    }),
  ]);

  const doneMap: Record<string, number> = {
    GROWTH: 0,
    MONEY: 0,
    SYSTEM: 0,
    LIFE: 0,
    UNKNOWN: 0,
  };
  for (const row of doneByCategory) {
    doneMap[row.category] = row._count;
  }

  const closureRate = tasksAdded > 0 ? tasksDone / tasksAdded : 0;

  return {
    tasksAdded,
    tasksDone,
    tasksOpenNow,
    overdueOpenNow,
    closureRate,
    doneMap,
  };
};

const formatWeeklyReviewText = (params: {
  title: string;
  from: DateTime;
  to: DateTime;
  stats: Awaited<ReturnType<typeof buildReviewStats>>;
}): string => {
  const { title, from, to, stats } = params;
  return [
    title,
    "",
    `Период: ${from.toFormat("dd.LL.yyyy HH:mm")} — ${to.toFormat("dd.LL.yyyy HH:mm")}`,
    `Добавлено задач: ${stats.tasksAdded}`,
    `Закрыто задач: ${stats.tasksDone}`,
    `Открыто сейчас: ${stats.tasksOpenNow}`,
    `Просрочено сейчас: ${stats.overdueOpenNow}`,
    `Closure rate: ${(stats.closureRate * 100).toFixed(1)}%`,
    "",
    "Закрыто по категориям:",
    `- GROWTH: ${stats.doneMap.GROWTH}`,
    `- MONEY: ${stats.doneMap.MONEY}`,
    `- SYSTEM: ${stats.doneMap.SYSTEM}`,
    `- LIFE: ${stats.doneMap.LIFE}`,
    `- UNKNOWN: ${stats.doneMap.UNKNOWN}`,
  ].join("\n");
};

const getOpenTasksAgeStats = async (userId: string, now: DateTime) => {
  const openTasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN },
    select: { createdAt: true },
  });

  const ages = openTasks.map((task) =>
    Math.max(0, now.diff(DateTime.fromJSDate(task.createdAt), "days").days)
  );
  const total = ages.length;
  const avgOpenAgeDays = total ? ages.reduce((acc, v) => acc + v, 0) / total : 0;
  const oldestTaskAgeDays = total ? Math.max(...ages) : 0;
  const tasksOlderThan7Days = ages.filter((d) => d > 7).length;
  const tasksOlderThan14Days = ages.filter((d) => d > 14).length;

  return {
    avgOpenAgeDays: Number(avgOpenAgeDays.toFixed(1)),
    oldestTaskAgeDays: Number(oldestTaskAgeDays.toFixed(0)),
    tasksOlderThan7Days,
    tasksOlderThan14Days,
  };
};

const getWeeklyEmotionStats = async (userId: string, from: DateTime, to: DateTime) => {
  const checkins = await prisma.dailyCheckIn.findMany({
    where: {
      userId,
      day: {
        gte: from.startOf("day").toJSDate(),
        lte: to.endOf("day").toJSDate(),
      },
    },
    select: { day: true, energy: true, mood: true },
  });

  if (!checkins.length) {
    return {
      avgEnergy: 3,
      minEnergy: 3,
      maxEnergy: 3,
      negativeMoodDays: 0,
    };
  }

  const energies = checkins.map((c) => c.energy);
  const negativeDays = new Set(
    checkins
      .filter((c) => moodToInt(c.mood) < 0)
      .map((c) => DateTime.fromJSDate(c.day).toFormat("yyyy-LL-dd"))
  );

  return {
    avgEnergy: Number((energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(1)),
    minEnergy: Math.min(...energies),
    maxEnergy: Math.max(...energies),
    negativeMoodDays: negativeDays.size,
  };
};

const getProjectsSnapshotForPeriod = async (params: {
  userId: string;
  from: DateTime;
  to: DateTime;
}) => {
  const projects = await prisma.project.findMany({
    where: {
      userId: params.userId,
      status: { in: ["IDEA", "ACTIVE", "PRE_LAUNCH"] },
    },
    select: {
      id: true,
      name: true,
      status: true,
      energyScore: true,
    },
    orderBy: [{ weeklyFocus: "desc" }, { updatedAt: "desc" }],
    take: 20,
  });

  if (!projects.length) {
    return [];
  }

  const counts = await prisma.task.groupBy({
    by: ["projectId", "category"],
    where: {
      userId: params.userId,
      status: TaskStatus.DONE,
      projectId: { in: projects.map((p) => p.id) },
      completedAt: {
        gte: params.from.toJSDate(),
        lte: params.to.toJSDate(),
      },
    },
    _count: true,
  });

  const map = new Map<string, { MONEY: number; GROWTH: number; SYSTEM: number }>();
  for (const project of projects) {
    map.set(project.id, { MONEY: 0, GROWTH: 0, SYSTEM: 0 });
  }
  for (const row of counts) {
    if (!row.projectId) continue;
    const entry = map.get(row.projectId);
    if (!entry) continue;
    if (row.category === "MONEY") entry.MONEY = row._count;
    if (row.category === "GROWTH") entry.GROWTH = row._count;
    if (row.category === "SYSTEM") entry.SYSTEM = row._count;
  }

  return projects.map((project) => {
    const c = map.get(project.id) ?? { MONEY: 0, GROWTH: 0, SYSTEM: 0 };
    return {
      name: project.name,
      status: project.status,
      energyScore: project.energyScore,
      moneyTasksDone: c.MONEY,
      growthTasksDone: c.GROWTH,
      systemTasksDone: c.SYSTEM,
    };
  });
};

export const runRollingWeeklyReview = async (user: User): Promise<string> => {
  const now = DateTime.now().setZone(user.timezone);
  const from = now.minus({ days: 7 });
  const to = now;
  const agentMode = await getAgentModeForUser(user.id);

  const stats = await buildReviewStats({
    userId: user.id,
    from,
    to,
    now,
  });
  const ageStats = await getOpenTasksAgeStats(user.id, now);
  const weeklyEmotion = await getWeeklyEmotionStats(user.id, from, to);
  const projectsSnapshot = await getProjectsSnapshotForPeriod({
    userId: user.id,
    from,
    to,
  });
  const focusProject = await getActiveFocusProject(user.id);
  const planBehavior = await buildBehaviorPatternsForPeriod(user, from, to);

  const weeklyInput: WeeklyReviewInput = {
    agentMode,
    periodDescription: `${from.toFormat("dd.LL.yyyy HH:mm")} — ${to.toFormat("dd.LL.yyyy HH:mm")}`,
    weeklyFeatures: {
      tasksAdded: stats.tasksAdded,
      tasksDone: stats.tasksDone,
      avgPerDayDone: Number((stats.tasksDone / 7).toFixed(0)),
      avgOpenAgeDays: ageStats.avgOpenAgeDays,
      oldestTaskAgeDays: ageStats.oldestTaskAgeDays,
      tasksOlderThan7Days: ageStats.tasksOlderThan7Days,
      tasksOlderThan14Days: ageStats.tasksOlderThan14Days,
    },
    weeklyEmotion,
    categoryDistribution: {
      MONEY: stats.doneMap.MONEY,
      GROWTH: stats.doneMap.GROWTH,
      SYSTEM: stats.doneMap.SYSTEM,
      LIFE: stats.doneMap.LIFE,
    },
    weeklyAgeStats: ageStats,
    projectsSnapshot,
    focusProject: focusProject
      ? {
          name: focusProject.name,
          status: focusProject.status,
          energyScore: focusProject.energyScore,
          vision: focusProject.vision,
          metric: focusProject.metric,
        }
      : null,
    planBehavior,
  };

  const analysis = await generateWeeklyReviewAnalysis(weeklyInput);

  const text = truncate(
    [
      "📘 Review (последние 7 дней от текущего момента)",
      "",
      `Период: ${weeklyInput.periodDescription}`,
      `Паттерн: ${analysis.mainPattern || "—"}`,
      `Проблема: ${analysis.strategicProblem || "—"}`,
      `SYSTEM перегруз: ${analysis.systemOverload ? "да" : "нет"}`,
      `Дефицит GROWTH: ${analysis.growthDeficit ? "да" : "нет"}`,
      `Избегание: ${analysis.avoidanceDetected ? "да" : "нет"}`,
      `Энергия: ${analysis.energyTrend || "—"}`,
      `Фокус-проект: ${analysis.focusProjectProgress || "—"}`,
      `Риск недели: ${analysis.warning || "—"}`,
      "",
      "Корректировки на следующую неделю:",
      ...analysis.nextWeekAdjustments.map((item) => `- ${item}`),
      ...(analysis.projectsToPause.length
        ? ["", `Кандидаты на паузу: ${analysis.projectsToPause.join(", ")}`]
        : []),
    ].join("\n"),
    4000
  );

  await prisma.summary.create({
    data: {
      userId: user.id,
      period: "WEEKLY_REVIEW_ROLLING",
      day: now.startOf("day").toJSDate(),
      text,
    },
  });

  return text;
};

const lastCalendarWeekRange = (tz: string) => {
  const now = DateTime.now().setZone(tz);
  const currentWeekStart = now.startOf("week");
  const from = currentWeekStart.minus({ weeks: 1 });
  const to = currentWeekStart.minus({ milliseconds: 1 });
  return { now, from, to };
};

const mondayReviewSentRuleKey = (userId: string, weekTag: string) =>
  `weekly_calendar_review_sent:${userId}:${weekTag}`;

export const sendCalendarWeekReviewToAllUsers = async (bot: Bot): Promise<void> => {
  const users = await prisma.user.findMany({ select: { id: true, tgUserId: true, timezone: true } });

  for (const user of users) {
    const { now, from, to } = lastCalendarWeekRange(user.timezone);
    const weekTag = `${from.weekYear}-W${String(from.weekNumber).padStart(2, "0")}`;
    const sentKey = mondayReviewSentRuleKey(user.id, weekTag);
    const alreadySent = await prisma.userRule.findUnique({ where: { key: sentKey } });
    if (alreadySent?.isActive) {
      continue;
    }

    const stats = await buildReviewStats({
      userId: user.id,
      from,
      to,
      now,
    });

    const text = truncate(
      formatWeeklyReviewText({
        title: "📊 Weekly Review (прошлая календарная неделя)",
        from,
        to,
        stats,
      }),
      4000
    );

    try {
      await bot.api.sendMessage(Number(user.tgUserId), text);
      await prisma.summary.create({
        data: {
          userId: user.id,
          period: "WEEKLY_REVIEW_CALENDAR",
          day: now.startOf("day").toJSDate(),
          text,
        },
      });
      await prisma.userRule.upsert({
        where: { key: sentKey },
        update: {
          value: { sentAt: new Date().toISOString() },
          isActive: true,
          userId: user.id,
        },
        create: {
          key: sentKey,
          userId: user.id,
          value: { sentAt: new Date().toISOString() },
          isActive: true,
        },
      });
    } catch (error) {
      console.error(`[WeeklyReviewCron] failed for user ${user.tgUserId}`, error);
    }
  }
};

export const runDailyReview = async (user: User) => {
  const day = DateTime.now().setZone(user.timezone).startOf("day");

  const doneToday = await prisma.task.findMany({
    where: {
      userId: user.id,
      status: TaskStatus.DONE,
      completedAt: {
        gte: day.toJSDate(),
        lte: day.endOf("day").toJSDate(),
      },
    },
    select: { title: true },
    take: 50,
  });

  const failed = await prisma.task.findMany({
    where: {
      userId: user.id,
      status: TaskStatus.OPEN,
      dueAt: {
        lt: day.endOf("day").toJSDate(),
      },
    },
    select: { title: true },
    take: 50,
  });

  const input = {
    day: day.toFormat("yyyy-LL-dd"),
    done: doneToday.map((task) => task.title),
    failed: failed.map((task) => task.title),
    notes: "",
  };

  const output = await generateReview(input);

  const text = truncate(
    [
      `Сработало: ${output.whatWorked.join("; ") || "—"}`,
      `Не сработало: ${output.whatFailed.join("; ") || "—"}`,
      `Причина: ${output.likelyReasonCode}`,
      `Коррекция: ${output.tomorrowAdjustment}`,
      `Микрошаг: ${output.microStep}`,
    ].join("\n"),
    4000
  );

  await prisma.summary.create({
    data: {
      userId: user.id,
      period: "DAILY_REVIEW",
      day: day.toJSDate(),
      text,
    },
  });

  return output;
};

export const runTextSummary = async (user: User, period: "DAILY" | "WEEKLY") => {
  const now = DateTime.now().setZone(user.timezone);
  const start = period === "DAILY" ? now.startOf("day") : now.startOf("week");
  const end = now.endOf("day");

  const [tasksDone, tasksOpen, overdueOpen, latestReviews] = await Promise.all([
    prisma.task.count({
      where: {
        userId: user.id,
        status: TaskStatus.DONE,
        completedAt: {
          gte: start.toJSDate(),
          lte: end.toJSDate(),
        },
      },
    }),
    prisma.task.count({ where: { userId: user.id, status: TaskStatus.OPEN } }),
    prisma.task.count({
      where: {
        userId: user.id,
        status: TaskStatus.OPEN,
        dueAt: { lt: now.startOf("day").toJSDate() },
      },
    }),
    prisma.summary.findMany({
      where: {
        userId: user.id,
        period: "DAILY_REVIEW",
        day: {
          gte: start.toJSDate(),
          lte: end.toJSDate(),
        },
      },
      orderBy: { day: "desc" },
      take: 7,
      select: { text: true, day: true },
    }),
  ]);

  const text = await generateTextSummary(period, {
    period,
    range: {
      from: start.toISO(),
      to: end.toISO(),
    },
    metrics: {
      tasksDone,
      tasksOpen,
      overdueOpen,
    },
    reviews: latestReviews,
  });

  const limit = period === "DAILY" ? 1200 : 2500;
  const normalized = truncate(text, limit);

  await prisma.summary.create({
    data: {
      userId: user.id,
      period,
      day: now.startOf("day").toJSDate(),
      text: normalized,
    },
  });

  return normalized;
};
