import { createConversation } from "@grammyjs/conversations";
import { InlineKeyboard, Keyboard } from "grammy";
import type { BotContext, BotConversation } from "../types/bot-context.types";
import {
  consumeVoiceCheckinPending,
  processVoiceCheckin,
  saveDailyCheckin,
  setVoiceCheckinPending,
} from "../services/emotion.service";
import { ensureUserByTelegramId } from "../services/user.service";
import { safeReply } from "../utils/telegram";

const reasonKeyboard = new Keyboard()
  .text("Нет ясности")
  .text("Слишком большая задача")
  .row()
  .text("Страх последствий")
  .text("Сон")
  .row()
  .text("Усталость")
  .text("Социальная тревога")
  .row()
  .text("Переключение контекста")
  .text("Перегруз")
  .row()
  .text("Другое")
  .resized();

const level1to5Keyboard = new Keyboard().text("1").text("2").text("3").text("4").text("5").resized();
const moodKeyboard = new Keyboard().text("-2").text("-1").text("0").text("1").text("2").resized();

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

const waitText = async (conversation: BotConversation, ctx: BotContext): Promise<string> => {
  while (true) {
    const update = await conversation.wait();
    const text = update.message?.text?.trim();
    if (text) {
      return text;
    }
    await ctx.reply("Нужен текстовый ответ");
  }
};

const reasonMap: Record<string, string> = {
  "НЕТ ЯСНОСТИ": "NO_CLARITY",
  "СЛИШКОМ БОЛЬШАЯ ЗАДАЧА": "BIG_TASK",
  "СТРАХ ПОСЛЕДСТВИЙ": "FEAR_CONSEQUENCES",
  "СОН": "SLEEP",
  "УСТАЛОСТЬ": "FATIGUE",
  "СОЦИАЛЬНАЯ ТРЕВОГА": "SOCIAL_ANXIETY",
  "ПЕРЕКЛЮЧЕНИЕ КОНТЕКСТА": "CONTEXT_SWITCH",
  "ПЕРЕГРУЗ": "OVERLOAD",
  "ДРУГОЕ": "OTHER",
};

const askIntInRange = async (
  conversation: BotConversation,
  ctx: BotContext,
  prompt: string,
  min: number,
  max: number,
  keyboard?: Keyboard
): Promise<number> => {
  if (keyboard) {
    await ctx.reply(prompt, { reply_markup: keyboard });
  }
  while (true) {
    const value = await waitText(conversation, ctx);
    const n = Number(value);
    if (Number.isInteger(n) && n >= min && n <= max) {
      return n;
    }
    await ctx.reply(`Введите число от ${min} до ${max}`);
  }
};

export const textCheckinConversation = async (
  conversation: BotConversation,
  ctx: BotContext,
  data?: { isMorning?: boolean }
): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await ensureUserByTelegramId(tgUserId);
  const isMorning = Boolean(data?.isMorning);

  const energy = await askIntInRange(conversation, ctx, "Энергия? (1-5)", 1, 5, level1to5Keyboard);
  const focus = await askIntInRange(conversation, ctx, "Фокус? (1-5)", 1, 5, level1to5Keyboard);
  const mood = await askIntInRange(conversation, ctx, "Настроение? (-2..2)", -2, 2, moodKeyboard);

  await ctx.reply("Причина?", { reply_markup: reasonKeyboard });
  const reasonInput = (await waitText(conversation, ctx)).trim().toUpperCase();
  const reasonCode = reasonMap[reasonInput] ?? "OTHER";

  const note = await askText(conversation, ctx, "Короткий комментарий (или -)");

  await saveDailyCheckin({
    userId: user.id,
    timezone: user.timezone,
    isMorning,
    energy,
    focus,
    mood,
    reasonCode,
    note: note === "-" ? "" : note,
  });

  await ctx.reply("✅ Самочувствие сохранено", { reply_markup: { remove_keyboard: true } });
};

export const moodPromptCommand = async (ctx: BotContext): Promise<void> => {
  const periodKeyboard = new InlineKeyboard()
    .text("Утро", "mood:period:morning")
    .text("Вечер", "mood:period:evening");
  await safeReply(ctx, "Как твое самочувствие сегодня?");
  await ctx.reply("Выбери период:", { reply_markup: periodKeyboard });
};

export const moodCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("mood:")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await ensureUserByTelegramId(tgUserId);
  const [, mode, period] = data.split(":");
  const isMorning = period === "morning";

  if (mode === "period") {
    await ctx.answerCallbackQuery();
    const inputKeyboard = new InlineKeyboard()
      .text("Голосовое", `mood:voice:${period}`)
      .text("Текст", `mood:text:${period}`);
    await ctx.reply("Как отправишь самочувствие?", { reply_markup: inputKeyboard });
    return;
  }

  if (mode === "voice") {
    await setVoiceCheckinPending(user.id, isMorning);
    await ctx.answerCallbackQuery();
    await safeReply(ctx, "Пришлите свое самочувствие");
    return;
  }

  if (mode === "text") {
    await ctx.answerCallbackQuery();
    await (ctx as unknown as { conversation: { enter: (name: string, data?: { isMorning?: boolean }) => Promise<void> } }).conversation.enter(
      "textCheckinConversation",
      { isMorning }
    );
  }
};

export const voiceMoodMessageHandler = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;
  const voice = ctx.message?.voice;
  if (!voice) return;

  const user = await ensureUserByTelegramId(tgUserId);
  const pending = await consumeVoiceCheckinPending(user.id);
  if (!pending) {
    return;
  }

  await safeReply(ctx, "Обрабатываю голосовое, подожди немного...");
  try {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error("BOT_TOKEN not configured");
    }

    const result = await processVoiceCheckin({
      botToken,
      fileId: voice.file_id,
      userId: user.id,
      timezone: user.timezone,
      isMorning: pending.isMorning,
    });

    await safeReply(
      ctx,
      `✅ Сохранено\nЭнергия: ${result.extracted.energy}/5\nФокус: ${result.extracted.focus}/5\nНастроение: ${result.extracted.mood}\nПричина: ${result.extracted.reasonCode}`
    );
  } catch (error: unknown) {
    console.error("[Mood] voice processing failed", error);
    await safeReply(
      ctx,
      "⚠️ Не удалось обработать голосовое. Используй кнопку Текст или попробуй позже."
    );
  }
};

export const textCheckinConversationMiddleware = createConversation(textCheckinConversation as any);
