import type { Context } from "grammy";
import { prisma } from "../db/prisma";
import { ensureUserByTelegramId } from "../services/user.service";
import { runPlanAndStoreSuggestions } from "../services/planning.service";
import { safeReply } from "../utils/telegram";

export const planCommand = async (ctx: Context): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) {
    return;
  }

  console.log(`[Bot] /plan requested by user ${tgUserId}`);
  await safeReply(ctx, "Собираю информацию");

  const user = await ensureUserByTelegramId(tgUserId);
  let plan;
  try {
    plan = await runPlanAndStoreSuggestions(user);
  } catch (error: unknown) {
    console.error("[Bot] /plan failed", error);
    await safeReply(
      ctx,
      "⚠️ Не удалось построить план. Проверь COMET_API_KEY/COMET_MODEL и повтори позже."
    );
    return;
  }

  const focusTaskIds = plan.focus.map((item) => item.taskId);
  const focusTasks = focusTaskIds.length
    ? await prisma.task.findMany({
        where: {
          userId: user.id,
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

  await safeReply(ctx, lines.join("\n"));
};
