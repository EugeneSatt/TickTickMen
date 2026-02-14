import { InlineKeyboard } from "grammy";
import { prisma } from "../db/prisma";
import {
  addProjectNote,
  listProjects,
  upsertUserByTelegramId,
  getProjectWithRecentNotes,
} from "../services/project.service";
import type { BotContext } from "../types/bot-context.types";
import { safeReply } from "../utils/telegram";

const PENDING_KEY_PREFIX = "project_note_pending:";

const getPendingKey = (userId: string): string => `${PENDING_KEY_PREFIX}${userId}`;

const buildProjectsKeyboard = async (userId: string): Promise<InlineKeyboard | null> => {
  const projects = await listProjects(userId);
  if (!projects.length) {
    return null;
  }

  const keyboard = new InlineKeyboard();
  for (const project of projects) {
    keyboard.text(project.name, `project_note:set:${project.id}`).row();
  }
  return keyboard;
};

const setPendingProject = async (userId: string, projectId: string): Promise<void> => {
  const key = getPendingKey(userId);
  await prisma.userRule.upsert({
    where: { key },
    update: {
      userId,
      isActive: true,
      value: { projectId, createdAt: new Date().toISOString() },
    },
    create: {
      key,
      userId,
      isActive: true,
      value: { projectId, createdAt: new Date().toISOString() },
    },
  });
};

const consumePendingProject = async (userId: string): Promise<string | null> => {
  const key = getPendingKey(userId);
  const rule = await prisma.userRule.findUnique({ where: { key } });
  if (!rule || !rule.isActive) {
    return null;
  }

  await prisma.userRule.update({
    where: { key },
    data: { isActive: false },
  });

  const value = rule.value as { projectId?: string };
  return value.projectId?.trim() || null;
};

export const projectNoteCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);
  const keyboard = await buildProjectsKeyboard(user.id);
  if (!keyboard) {
    await safeReply(ctx, "📭 Нет проектов. Сначала создай: /project_new");
    return;
  }

  await ctx.reply("Выбери проект для заметки:", { reply_markup: keyboard });
};

export const projectNoteCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("project_note:set:")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);
  const projectId = data.replace("project_note:set:", "").trim();
  const project = await getProjectWithRecentNotes(user.id, projectId);
  if (!project) {
    await ctx.answerCallbackQuery({ text: "Проект не найден" });
    return;
  }

  await setPendingProject(user.id, projectId);
  await ctx.answerCallbackQuery({ text: "Выбрано" });
  await safeReply(ctx, `Отправь текст заметки для проекта "${project.name}" (до 1000 символов)`);
};

export const projectNoteTextHandler = async (ctx: BotContext): Promise<void> => {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await upsertUserByTelegramId(tgUserId);
  const projectId = await consumePendingProject(user.id);
  if (!projectId) {
    return;
  }

  const project = await getProjectWithRecentNotes(user.id, projectId);
  if (!project) {
    await safeReply(ctx, "⚠️ Проект не найден, заметка не сохранена");
    return;
  }

  await addProjectNote(user.id, projectId, text);
  await safeReply(ctx, `📝 Заметка сохранена для ${project.name}`);
};

