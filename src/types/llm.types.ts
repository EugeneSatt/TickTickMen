import type { PlanSuggestionCategory, ReasonCode } from "./domain.types";

export interface PlanInput {
  today: {
    day: string;
    energy: number;
    focus: number;
    mood: number;
    note: string;
    yesterdayEvening: {
      energy: number | null;
      mood: number | null;
      note: string;
    } | null;
  };
  features7d: Record<string, number | string | boolean | null>;
  activeTasks: Array<{
    id: string;
    title: string;
    project: string;
    dueAt: string | null;
    category: string;
    ageDays: number;
  }>;
  focusProject: {
    name: string;
    status: string;
    vision: string | null;
    metric: string | null;
    revenueGoal: number | null;
    riskLevel: number | null;
    energyScore: number | null;
  } | null;
  rules: Record<string, unknown>;
}

export interface PlanOutput {
  focus: Array<{
    taskId: string;
    reason: string;
  }>;
  fallbackOptions: Array<{
    forTaskId: string;
    alternativeAction: string;
    reason: string;
  }>;
  doNotDo: string;
  riskOfTheDay: string;
  warnings: string[];
  strategyNote: string;
  categorySuggestions: Array<{
    taskId: string;
    category: PlanSuggestionCategory;
    confidence: number;
    reason: string;
  }>;
}

export interface ReviewOutput {
  whatWorked: string[];
  whatFailed: string[];
  likelyReasonCode: ReasonCode;
  tomorrowAdjustment: string;
  microStep: string;
}

export interface WeeklyReviewInput {
  periodDescription: string;
  weeklyFeatures: {
    tasksAdded: number;
    tasksDone: number;
    avgPerDayDone: number;
    avgOpenAgeDays: number;
    oldestTaskAgeDays: number;
    tasksOlderThan7Days: number;
    tasksOlderThan14Days: number;
  };
  weeklyEmotion: {
    avgEnergy: number;
    minEnergy: number;
    maxEnergy: number;
    negativeMoodDays: number;
  };
  categoryDistribution: {
    MONEY: number;
    GROWTH: number;
    SYSTEM: number;
    LIFE: number;
  };
  weeklyAgeStats: {
    avgOpenAgeDays: number;
    oldestTaskAgeDays: number;
    tasksOlderThan7Days: number;
    tasksOlderThan14Days: number;
  };
  projectsSnapshot: Array<{
    name: string;
    status: string;
    energyScore: number | null;
    moneyTasksDone: number;
    growthTasksDone: number;
    systemTasksDone: number;
  }>;
  focusProject: {
    name: string;
    status: string;
    energyScore: number | null;
    vision: string | null;
    metric: string | null;
  } | null;
}

export interface WeeklyReviewOutput {
  mainPattern: string;
  systemOverload: boolean;
  growthDeficit: boolean;
  avoidanceDetected: boolean;
  energyTrend: "падение" | "рост" | "нестабильно" | string;
  focusProjectProgress: "реальный прогресс" | "имитация движения" | "отсутствует" | string;
  strategicProblem: string;
  nextWeekAdjustments: string[];
  projectsToPause: string[];
  warning: string;
}
