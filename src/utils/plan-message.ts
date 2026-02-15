import { prisma } from "../db/prisma";
import type { PlanOutput } from "../types/llm.types";

export const buildPlanMessage = async (userId: string, plan: PlanOutput): Promise<string> => {
  const focusTaskIds = plan.focus.map((item) => item.taskId);
  const focusTasks = focusTaskIds.length
    ? await prisma.task.findMany({
        where: {
          userId,
          id: { in: focusTaskIds },
        },
        select: {
          id: true,
          title: true,
        },
      })
    : [];

  const focusTitleById = new Map(focusTasks.map((task) => [task.id, task.title]));
  const focusTitles = plan.focus.map((item) => focusTitleById.get(item.taskId) ?? item.reason).filter(Boolean);
  const warningItems = plan.warnings
    .flatMap((warning) => warning.split(";"))
    .map((warning) => warning.trim())
    .filter(Boolean);
  const focusLines =
    focusTitles.length > 0
      ? focusTitles.map((title, index) => `${index + 1}. ${title}`)
      : ["—"];
  const warningLines =
    warningItems.length > 0
      ? warningItems.map((warning, index) => `${index + 1}. ${warning}`)
      : ["—"];

  const lines = [
    "🧭 План на день",
    "",
    "Фокус:",
    ...focusLines,
    "",
    `Fallback-варианты: ${plan.fallbackOptions.length || 0}`,
    "",
    "Не делать:",
    plan.doNotDo || "—",
    "",
    "Риск дня:",
    plan.riskOfTheDay || "—",
    "",
    "Предупреждения:",
    ...warningLines,
    "",
    "Стратегия:",
    plan.strategyNote || "—",
    "",
    `Категорий к применению: ${plan.categorySuggestions.length}`,
    "",
    "Чтобы применить категории: /apply_categories",
  ];

  return lines.join("\n");
};

