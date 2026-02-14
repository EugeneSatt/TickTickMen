import { InlineKeyboard } from "grammy";
import { prisma } from "../db/prisma";
import {
  listProjects,
  updateProject,
  upsertUserByTelegramId,
} from "../services/project.service";
import type { BotContext } from "../types/bot-context.types";
import {
  parseHorizonMonths,
  parseMaybeText,
  parseNonNegativeNumber,
  parseProjectStatus,
  parseScale1to5,
} from "../utils/project";
import { safeReply } from "../utils/telegram";

const PENDING_KEY_PREFIX = "project_update_pending:";

type EditableField =
  | "status"
  | "horizonMonths"
  | "riskLevel"
  | "energyScore"
  | "revenueGoal"
  | "vision"
  | "metric";

const fieldLabel: Record<EditableField, string> = {
  status: "Статус",
  horizonMonths: "Горизонт (мес)",
  riskLevel: "Риск",
  energyScore: "Мотивация",
  revenueGoal: "Цель дохода",
  vision: "Видение",
  metric: "Метрика",
};

const getPendingKey = (userId: string): string => `${PENDING_KEY_PREFIX}${userId}`;

const buildProjectsKeyboard = async (userId: string): Promise<InlineKeyboard | null> => {
  const projects = await listProjects(userId);
  if (!projects.length) {
    return null;
  }

  const keyboard = new InlineKeyboard();
  for (const project of projects) {
    keyboard.text(project.name, `project_update:project:${project.id}`).row();
  }
  return keyboard;
};

const buildFieldsKeyboard = (projectId: string): InlineKeyboard =>
  new InlineKeyboard()
    .text("Статус", `project_update:field:${projectId}:status`)
    .text("Горизонт", `project_update:field:${projectId}:horizonMonths`)
    .row()
    .text("Риск", `project_update:field:${projectId}:riskLevel`)
    .text("Мотивация", `project_update:field:${projectId}:energyScore`)
    .row()
    .text("Цель дохода", `project_update:field:${projectId}:revenueGoal`)
    .row()
    .text("Видение", `project_update:field:${projectId}:vision`)
    .text("Метрика", `project_update:field:${projectId}:metric`);

const buildStatusKeyboard = (projectId: string): InlineKeyboard =>
  new InlineKeyboard()
    .text("IDEA", `project_update:set:${projectId}:status:IDEA`)
    .text("ACTIVE", `project_update:set:${projectId}:status:ACTIVE`)
    .row()
    .text("PRE_LAUNCH", `project_update:set:${projectId}:status:PRE_LAUNCH`)
    .row()
    .text("PAUSED", `project_update:set:${projectId}:status:PAUSED`)
    .text("DONE", `project_update:set:${projectId}:status:DONE`);

const buildScaleKeyboard = (projectId: string, field: "riskLevel" | "energyScore"): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  for (const val of [1, 2, 3, 4, 5]) {
    keyboard.text(String(val), `project_update:set:${projectId}:${field}:${val}`);
  }
  return keyboard;
};

const buildHorizonKeyboard = (projectId: string): InlineKeyboard =>
  new InlineKeyboard()
    .text("3", `project_update:set:${projectId}:horizonMonths:3`)
    .text("6", `project_update:set:${projectId}:horizonMonths:6`)
    .text("12", `project_update:set:${projectId}:horizonMonths:12`)
    .row()
    .text("Очистить", `project_update:set:${projectId}:horizonMonths:null`);

const setPendingTextUpdate = async (userId: string, projectId: string, field: EditableField) => {
  const key = getPendingKey(userId);
  await prisma.userRule.upsert({
    where: { key },
    update: {
      value: { projectId, field, createdAt: new Date().toISOString() },
      isActive: true,
      userId,
    },
    create: {
      key,
      userId,
      value: { projectId, field, createdAt: new Date().toISOString() },
      isActive: true,
    },
  });
};

const consumePendingTextUpdate = async (
  userId: string
): Promise<{ projectId: string; field: EditableField } | null> => {
  const key = getPendingKey(userId);
  const rule = await prisma.userRule.findUnique({ where: { key } });
  if (!rule || !rule.isActive) {
    return null;
  }

  await prisma.userRule.update({ where: { key }, data: { isActive: false } });

  const value = rule.value as { projectId?: string; field?: EditableField };
  if (!value.projectId || !value.field) {
    return null;
  }

  return { projectId: value.projectId, field: value.field };
};

const applyFieldValue = async (params: {
  userId: string;
  projectId: string;
  field: EditableField;
  rawValue: string;
}) => {
  const { userId, projectId, field, rawValue } = params;

  if (field === "status") {
    const parsed = parseProjectStatus(rawValue);
    if (!parsed) {
      throw new Error("Статус должен быть IDEA|ACTIVE|PRE_LAUNCH|PAUSED|DONE");
    }
    await updateProject(userId, projectId, { status: parsed });
    return;
  }

  if (field === "horizonMonths") {
    const value = rawValue === "null" ? null : parseHorizonMonths(rawValue);
    await updateProject(userId, projectId, { horizonMonths: value });
    return;
  }

  if (field === "riskLevel") {
    const value = parseScale1to5(rawValue, "riskLevel");
    await updateProject(userId, projectId, { riskLevel: value });
    return;
  }

  if (field === "energyScore") {
    const value = parseScale1to5(rawValue, "energyScore");
    await updateProject(userId, projectId, { energyScore: value });
    return;
  }

  if (field === "revenueGoal") {
    const value = parseNonNegativeNumber(rawValue, "revenueGoal");
    await updateProject(userId, projectId, { revenueGoal: value });
    return;
  }

  if (field === "vision") {
    const value = parseMaybeText(rawValue);
    await updateProject(userId, projectId, { vision: value });
    return;
  }

  if (field === "metric") {
    const value = parseMaybeText(rawValue);
    await updateProject(userId, projectId, { metric: value });
    return;
  }
};

export const projectUpdateCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);
  const keyboard = await buildProjectsKeyboard(user.id);
  if (!keyboard) {
    await safeReply(ctx, "📭 Нет проектов. Сначала создай: /project_new");
    return;
  }

  await ctx.reply("Выбери проект для обновления:", { reply_markup: keyboard });
};

export const projectUpdateCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("project_update:")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const user = await upsertUserByTelegramId(tgUserId);

  const parts = data.split(":");
  const mode = parts[1];

  if (mode === "project") {
    const projectId = parts[2];
    await ctx.answerCallbackQuery();
    await ctx.reply("Выбери метрику:", { reply_markup: buildFieldsKeyboard(projectId) });
    return;
  }

  if (mode === "field") {
    const projectId = parts[2];
    const field = parts[3] as EditableField;
    await ctx.answerCallbackQuery();

    if (field === "status") {
      await ctx.reply("Выбери стадию:", { reply_markup: buildStatusKeyboard(projectId) });
      return;
    }

    if (field === "riskLevel" || field === "energyScore") {
      await ctx.reply(`Выбери ${fieldLabel[field]}:`, {
        reply_markup: buildScaleKeyboard(projectId, field),
      });
      return;
    }

    if (field === "horizonMonths") {
      await ctx.reply("Выбери горизонт:", { reply_markup: buildHorizonKeyboard(projectId) });
      return;
    }

    await setPendingTextUpdate(user.id, projectId, field);
    const prompt =
      field === "revenueGoal"
        ? "Введи число >= 0 (или skip/- чтобы очистить)"
        : `Введи текст для поля ${fieldLabel[field]} (или skip/- чтобы очистить)`;
    await ctx.reply(prompt);
    return;
  }

  if (mode === "set") {
    const projectId = parts[2];
    const field = parts[3] as EditableField;
    const rawValue = parts.slice(4).join(":");

    try {
      await applyFieldValue({ userId: user.id, projectId, field, rawValue });
      await ctx.answerCallbackQuery({ text: "Сохранено" });
      await ctx.reply(`✅ Обновлено: ${fieldLabel[field]}`, {
        reply_markup: buildFieldsKeyboard(projectId),
      });
    } catch (error: unknown) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await safeReply(ctx, `⚠️ ${(error as Error).message}`);
    }
  }
};

export const projectUpdateTextHandler = async (ctx: BotContext): Promise<void> => {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const user = await upsertUserByTelegramId(tgUserId);

  const pending = await consumePendingTextUpdate(user.id);
  if (!pending) {
    return;
  }

  try {
    await applyFieldValue({
      userId: user.id,
      projectId: pending.projectId,
      field: pending.field,
      rawValue: text,
    });

    await safeReply(ctx, `✅ Обновлено: ${fieldLabel[pending.field]}`);
    await ctx.reply("Выбери следующую метрику:", {
      reply_markup: buildFieldsKeyboard(pending.projectId),
    });
  } catch (error: unknown) {
    await safeReply(ctx, `⚠️ ${(error as Error).message}`);
  }
};
