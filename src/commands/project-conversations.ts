import { Keyboard } from "grammy";
import type { Project, ProjectStatus } from "@prisma/client";
import type { BotContext, BotConversation } from "../types/bot-context.types";
import {
  addProjectNote,
  createProject,
  getProjectByNameOrId,
  getProjectWithRecentNotes,
  updateProject,
  upsertUserByTelegramId,
  weeklyProjectReview,
} from "../services/project.service";
import {
  formatProjectCard,
  parseHorizonMonths,
  parseMaybeText,
  parseNonNegativeNumber,
  parseProjectStatus,
  parseScale1to5,
  parseCommandArgs,
} from "../utils/project";
import { safeReply } from "../utils/telegram";

const statusKeyboard = new Keyboard()
  .text("IDEA")
  .text("ACTIVE")
  .text("PRE_LAUNCH")
  .row()
  .text("PAUSED")
  .text("DONE")
  .resized();

const fieldKeyboard = new Keyboard()
  .text("name")
  .text("status")
  .row()
  .text("horizonMonths")
  .text("revenueGoal")
  .row()
  .text("riskLevel")
  .text("energyScore")
  .row()
  .text("vision")
  .text("metric")
  .row()
  .text("Done")
  .resized();

const kindKeyboard = new Keyboard()
  .text("IDEA")
  .text("RISK")
  .text("DECISION")
  .row()
  .text("LINK")
  .text("OTHER")
  .text("skip")
  .resized();

const askText = async (conversation: BotConversation, ctx: BotContext, prompt: string): Promise<string> => {
  await ctx.reply(prompt);
  while (true) {
    const update = await conversation.wait();
    const text = update.message?.text?.trim();
    if (text) {
      return text;
    }
    await ctx.reply("Нужен текстовый ответ");
  }
};

const findProjectInteractive = async (
  conversation: BotConversation,
  ctx: BotContext,
  userId: string,
  initialRef?: string
): Promise<Project | null> => {
  let ref = initialRef?.trim();

  while (true) {
    if (!ref) {
      ref = await askText(conversation, ctx, "Укажи проект: name или id");
    }

    const resolved = await getProjectByNameOrId(userId, ref);
    if (resolved.project) {
      return resolved.project;
    }

    if (resolved.ambiguous.length) {
      await ctx.reply(
        [
          "Найдено несколько проектов. Выбери id:",
          ...resolved.ambiguous.map((p) => `- ${p.name} [${p.status}] id=${p.id}`),
        ].join("\n")
      );
      ref = await askText(conversation, ctx, "Введи точный id проекта");
      continue;
    }

    await ctx.reply("Проект не найден. Попробуй снова");
    ref = undefined;
  }
};

const parseAndValidateFieldValue = (field: string, rawValue: string): unknown => {
  if (field === "name") {
    const value = rawValue.trim();
    if (!value.length) {
      throw new Error("name не может быть пустым");
    }
    return value;
  }

  if (field === "status") {
    const status = parseProjectStatus(rawValue);
    if (!status) {
      throw new Error("status: IDEA|ACTIVE|PRE_LAUNCH|PAUSED|DONE");
    }
    return status;
  }

  if (field === "horizonMonths") {
    return parseHorizonMonths(rawValue);
  }

  if (field === "revenueGoal") {
    return parseNonNegativeNumber(rawValue, "revenueGoal");
  }

  if (field === "riskLevel") {
    return parseScale1to5(rawValue, "riskLevel");
  }

  if (field === "energyScore") {
    return parseScale1to5(rawValue, "energyScore");
  }

  if (field === "vision" || field === "metric") {
    return parseMaybeText(rawValue);
  }

  throw new Error("Неизвестное поле");
};

export const projectNewConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);

  const name = await askText(conversation, ctx, "1) Название проекта");

  await ctx.reply("2) Статус проекта", { reply_markup: statusKeyboard });
  const statusRaw = await askText(conversation, ctx, "Выбери статус: IDEA/ACTIVE/PRE_LAUNCH/PAUSED/DONE");
  const status = parseProjectStatus(statusRaw);
  if (!status) {
    await ctx.reply("⚠️ Неверный статус. Создание отменено");
    return;
  }

  let horizonMonths: number | null = null;
  try {
    horizonMonths = parseHorizonMonths(await askText(conversation, ctx, "3) horizonMonths: 3/6/12 или skip/-"));
  } catch (error) {
    await ctx.reply(`⚠️ ${(error as Error).message}. Создание отменено`);
    return;
  }

  let revenueGoal: number | null = null;
  try {
    revenueGoal = parseNonNegativeNumber(
      await askText(conversation, ctx, "4) revenueGoal >= 0 или skip/-"),
      "revenueGoal"
    );
  } catch (error) {
    await ctx.reply(`⚠️ ${(error as Error).message}. Создание отменено`);
    return;
  }

  let riskLevel: number | null = null;
  try {
    riskLevel = parseScale1to5(await askText(conversation, ctx, "5) riskLevel 1..5 или skip/-"), "riskLevel");
  } catch (error) {
    await ctx.reply(`⚠️ ${(error as Error).message}. Создание отменено`);
    return;
  }

  let energyScore: number | null = null;
  try {
    energyScore = parseScale1to5(
      await askText(conversation, ctx, "6) мотивация 1..5 или skip/-"),
      "energyScore"
    );
  } catch (error) {
    await ctx.reply(`⚠️ ${(error as Error).message}. Создание отменено`);
    return;
  }

  const vision = parseMaybeText(await askText(conversation, ctx, "7) видение или skip/-"));
  const metric = parseMaybeText(await askText(conversation, ctx, "8) метрика или skip/-"));

  const project = await createProject(user.id, {
    name,
    status,
    horizonMonths,
    revenueGoal,
    riskLevel,
    energyScore,
    vision,
    metric,
  });

  const withNotes = await getProjectWithRecentNotes(user.id, project.id);
  if (withNotes) {
    await ctx.reply(formatProjectCard(withNotes, withNotes.notes), {
      reply_markup: { remove_keyboard: true },
    });
  }
};

export const projectEditConversation = async (
  conversation: BotConversation,
  ctx: BotContext,
  data?: { projectRef?: string }
): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const user = await upsertUserByTelegramId(tgUserId);

  const project = await findProjectInteractive(conversation, ctx, user.id, data?.projectRef);
  if (!project) return;

  await ctx.reply(`Редактируем: ${project.name}`, { reply_markup: fieldKeyboard });

  let currentProject = project;
  while (true) {
    const field = await askText(conversation, ctx, "Какое поле изменить? (или Done)");
    if (field === "Done") {
      break;
    }

    try {
      const rawValue = await askText(conversation, ctx, `Новое значение для ${field} (или skip/- для null)`);
      const value = parseAndValidateFieldValue(field, rawValue);
      currentProject = await updateProject(user.id, currentProject.id, { [field]: value });
      await ctx.reply(`✅ ${field} обновлено`);
    } catch (error) {
      await ctx.reply(`⚠️ ${(error as Error).message}`);
    }
  }

  const withNotes = await getProjectWithRecentNotes(user.id, currentProject.id);
  if (withNotes) {
    await ctx.reply(formatProjectCard(withNotes, withNotes.notes), {
      reply_markup: { remove_keyboard: true },
    });
  }
};

export const projectReviewConversation = async (
  conversation: BotConversation,
  ctx: BotContext,
  data?: { projectRef?: string }
): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const user = await upsertUserByTelegramId(tgUserId);

  const project = await findProjectInteractive(conversation, ctx, user.id, data?.projectRef);
  if (!project) return;

  const progressedRaw = (await askText(conversation, ctx, "1) Продвинулся проект за неделю? (да/нет)")).toLowerCase();
  const progressed: "да" | "нет" = progressedRaw.includes("да") ? "да" : "нет";

  const riskText = await askText(conversation, ctx, "2) Главный риск сейчас? (1 строка)");
  const moneyTask = await askText(conversation, ctx, "3) Есть Money-задача на неделю? (строка или 'нет')");

  let energyScore = 3;
  try {
    energyScore = parseScale1to5(await askText(conversation, ctx, "4) Мотивация к проекту 1–5"), "energyScore") ?? 3;
  } catch (error) {
    await ctx.reply(`⚠️ ${(error as Error).message}. Будет использовано 3/5.`);
  }

  let riskLevel: number | null = null;
  const riskLevelRaw = await askText(conversation, ctx, "Опционально: оценка риска 1–5 (или skip/-)");
  try {
    riskLevel = parseScale1to5(riskLevelRaw, "riskLevel");
  } catch {
    riskLevel = null;
  }

  const updated = await weeklyProjectReview(user.id, project.id, {
    progressed,
    riskText,
    moneyTask,
    energyScore,
    riskLevel,
  });

  await ctx.reply(`✅ Review сохранен для ${updated.name}`, {
    reply_markup: { remove_keyboard: true },
  });
};

export const projectNoteConversation = async (
  conversation: BotConversation,
  ctx: BotContext,
  data?: { projectRef?: string }
): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const user = await upsertUserByTelegramId(tgUserId);

  const project = await findProjectInteractive(conversation, ctx, user.id, data?.projectRef);
  if (!project) return;

  const text = await askText(conversation, ctx, "Текст заметки (до 1000 символов)");
  await ctx.reply("Выбери kind или skip", { reply_markup: kindKeyboard });
  const kindRaw = await askText(conversation, ctx, "kind: IDEA/RISK/DECISION/LINK/OTHER или skip");
  const kind = kindRaw.toLowerCase() === "skip" || kindRaw === "-" ? undefined : kindRaw.toUpperCase();

  await addProjectNote(user.id, project.id, text, kind);
  await ctx.reply(`📝 Заметка сохранена для ${project.name}`, {
    reply_markup: { remove_keyboard: true },
  });
};

export const projectNewCommand = async (ctx: BotContext): Promise<void> => {
  await (ctx as unknown as { conversation: { enter: (name: string) => Promise<void> } }).conversation.enter(
    "projectNewConversation"
  );
};

export const projectEditCommand = async (ctx: BotContext): Promise<void> => {
  const args = parseCommandArgs(ctx.message?.text ?? "");
  const projectRef = args.length ? args.join(" ") : undefined;
  await (
    ctx as unknown as { conversation: { enter: (name: string, data?: { projectRef?: string }) => Promise<void> } }
  ).conversation.enter("projectEditConversation", { projectRef });
};

export const projectReviewCommand = async (ctx: BotContext): Promise<void> => {
  const args = parseCommandArgs(ctx.message?.text ?? "");
  const projectRef = args.length ? args.join(" ") : undefined;
  await (
    ctx as unknown as { conversation: { enter: (name: string, data?: { projectRef?: string }) => Promise<void> } }
  ).conversation.enter("projectReviewConversation", { projectRef });
};

export const projectNoteCommand = async (ctx: BotContext): Promise<void> => {
  const args = parseCommandArgs(ctx.message?.text ?? "");
  const projectRef = args.length ? args.join(" ") : undefined;
  await (
    ctx as unknown as { conversation: { enter: (name: string, data?: { projectRef?: string }) => Promise<void> } }
  ).conversation.enter("projectNoteConversation", { projectRef });
};
