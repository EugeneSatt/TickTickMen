import axios from "axios";
import FormData from "form-data";
import { DateTime } from "luxon";
import type { Bot } from "grammy";
import { MoodLevel, ReasonCode, type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { LLM_PROMPTS, SYSTEM_PROMPTS } from "../config/llm-prompts";
import { isWithinCronWindow } from "../utils/cron-time-window";

const COMET_API_BASE = "https://api.cometapi.com/v1";
const VOICE_PENDING_RULE_PREFIX = "voice_checkin_pending:";
const MOOD_PROMPT_SENT_PREFIX = "mood_prompt_sent:";

const REASON_CODES = [
  "NO_CLARITY",
  "BIG_TASK",
  "FEAR_CONSEQUENCES",
  "SLEEP",
  "FATIGUE",
  "SOCIAL_ANXIETY",
  "CONTEXT_SWITCH",
  "OVERLOAD",
  "OTHER",
] as const;

type FixedReasonCode = (typeof REASON_CODES)[number];

export interface CheckinExtraction {
  energy: number;
  focus: number;
  mood: number;
  reasonCode: FixedReasonCode;
  note: string;
}

const getCometApiKey = (): string => {
  const key = process.env.COMET_API_KEY ?? process.env.COMETAPI_API_KEY;
  if (!key) {
    throw new Error("Missing COMET_API_KEY/COMETAPI_API_KEY");
  }
  return key;
};

const moodIntToEnum = (value: number): MoodLevel => {
  if (value <= -2) return MoodLevel.M2;
  if (value === -1) return MoodLevel.M1;
  if (value === 0) return MoodLevel.Z0;
  if (value === 1) return MoodLevel.P1;
  return MoodLevel.P2;
};

const parseReasonCode = (value: string | undefined): ReasonCode => {
  const upper = value?.toUpperCase() ?? "OTHER";
  if (REASON_CODES.includes(upper as FixedReasonCode)) {
    return upper as ReasonCode;
  }
  return ReasonCode.OTHER;
};

const clampScale1to5 = (value: number): number => {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
};

const clampMood = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-2, Math.min(2, Math.round(value)));
};

const extractJsonObject = (text: string): string => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM output JSON not found");
  }
  return text.slice(start, end + 1);
};

export const saveDailyCheckin = async (params: {
  userId: string;
  timezone: string;
  isMorning: boolean;
  energy: number;
  focus: number;
  mood: number;
  reasonCode: string;
  note?: string;
}) => {
  const localDay = DateTime.now().setZone(params.timezone).startOf("day").toJSDate();

  return prisma.dailyCheckIn.upsert({
    where: {
      userId_day_isMorning: {
        userId: params.userId,
        day: localDay,
        isMorning: params.isMorning,
      },
    },
    update: {
      energy: clampScale1to5(params.energy),
      focus: clampScale1to5(params.focus),
      mood: moodIntToEnum(clampMood(params.mood)),
      reasonCode: parseReasonCode(params.reasonCode),
      note: params.note?.trim() ? params.note.trim().slice(0, 1000) : null,
    },
    create: {
      userId: params.userId,
      day: localDay,
      isMorning: params.isMorning,
      energy: clampScale1to5(params.energy),
      focus: clampScale1to5(params.focus),
      mood: moodIntToEnum(clampMood(params.mood)),
      reasonCode: parseReasonCode(params.reasonCode),
      note: params.note?.trim() ? params.note.trim().slice(0, 1000) : null,
    },
  });
};

const resolveTelegramFileUrl = async (botToken: string, fileId: string): Promise<string> => {
  const response = await axios.get<{ ok: boolean; result?: { file_path?: string } }>(
    `https://api.telegram.org/bot${botToken}/getFile`,
    {
      params: { file_id: fileId },
      timeout: 15000,
    }
  );

  const filePath = response.data.result?.file_path;
  if (!filePath) {
    throw new Error("Telegram file_path not found");
  }

  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
};

const transcribeVoiceWithComet = async (buffer: Buffer, filename = "voice.ogg"): Promise<string> => {
  const apiKey = getCometApiKey();
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", buffer, { filename, contentType: "audio/ogg" });

  const response = await axios.post<{ text?: string }>(`${COMET_API_BASE}/audio/transcriptions`, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: 60000,
    maxBodyLength: Infinity,
  });

  const text = response.data.text?.trim();
  if (!text) {
    throw new Error("Transcription is empty");
  }
  return text;
};

export const extractCheckinFromText = async (rawText: string): Promise<CheckinExtraction> => {
  const apiKey = getCometApiKey();
  const model = (process.env.COMET_MODEL ?? process.env.COMETAPI_MODEL ?? "gpt-5.2").trim() || "gpt-5.2";

  const system = LLM_PROMPTS.moodExtractionJson;

  const response = await axios.post<{ choices?: Array<{ message?: { content?: string } }> }>(
    `${COMET_API_BASE}/chat/completions`,
    {
      model,
      messages: [
        { role: SYSTEM_PROMPTS.role, content: system },
        { role: "user", content: rawText },
      ],
      temperature: 0.1,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const content = response.data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Empty extraction response");
  }

  const parsed = JSON.parse(extractJsonObject(content)) as Partial<CheckinExtraction>;

  return {
    energy: clampScale1to5(Number(parsed.energy ?? 3)),
    focus: clampScale1to5(Number(parsed.focus ?? 3)),
    mood: clampMood(Number(parsed.mood ?? 0)),
    reasonCode: (REASON_CODES.includes(parsed.reasonCode as FixedReasonCode)
      ? parsed.reasonCode
      : "OTHER") as FixedReasonCode,
    note: typeof parsed.note === "string" ? parsed.note.slice(0, 1000) : rawText.slice(0, 1000),
  };
};

export const processVoiceCheckin = async (params: {
  botToken: string;
  fileId: string;
  userId: string;
  timezone: string;
  isMorning: boolean;
}) => {
  const fileUrl = await resolveTelegramFileUrl(params.botToken, params.fileId);
  const fileResponse = await axios.get<ArrayBuffer>(fileUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });

  const buffer = Buffer.from(fileResponse.data);
  const transcript = await transcribeVoiceWithComet(buffer);
  const extracted = await extractCheckinFromText(transcript);

  await saveDailyCheckin({
    userId: params.userId,
    timezone: params.timezone,
    isMorning: params.isMorning,
    energy: extracted.energy,
    focus: extracted.focus,
    mood: extracted.mood,
    reasonCode: extracted.reasonCode,
    note: extracted.note,
  });

  return { transcript, extracted };
};

export const setVoiceCheckinPending = async (userId: string, isMorning: boolean) => {
  const key = `${VOICE_PENDING_RULE_PREFIX}${userId}`;
  await prisma.userRule.upsert({
    where: { key },
    update: {
      value: {
        isMorning,
        createdAt: new Date().toISOString(),
      },
      isActive: true,
      userId,
    },
    create: {
      userId,
      key,
      value: {
        isMorning,
        createdAt: new Date().toISOString(),
      },
      isActive: true,
    },
  });
};

export const consumeVoiceCheckinPending = async (userId: string): Promise<{ isMorning: boolean } | null> => {
  const key = `${VOICE_PENDING_RULE_PREFIX}${userId}`;
  const rule = await prisma.userRule.findUnique({ where: { key } });
  if (!rule || !rule.isActive) {
    return null;
  }

  await prisma.userRule.update({
    where: { key },
    data: { isActive: false },
  });

  const value = rule.value as { isMorning?: boolean };
  return { isMorning: Boolean(value?.isMorning) };
};

const promptSentKey = (userId: string, dayKey: string, isMorning: boolean): string =>
  `${MOOD_PROMPT_SENT_PREFIX}${userId}:${dayKey}:${isMorning ? "morning" : "evening"}`;

const upsertPromptSent = async (db: PrismaClient, userId: string, dayKey: string, isMorning: boolean) => {
  const key = promptSentKey(userId, dayKey, isMorning);
  await db.userRule.upsert({
    where: { key },
    update: {
      value: { sentAt: new Date().toISOString() },
      isActive: true,
      userId,
    },
    create: {
      userId,
      key,
      value: { sentAt: new Date().toISOString() },
      isActive: true,
    },
  });
};

const hasPromptSent = async (db: PrismaClient, userId: string, dayKey: string, isMorning: boolean) => {
  const key = promptSentKey(userId, dayKey, isMorning);
  const rule = await db.userRule.findUnique({ where: { key }, select: { key: true } });
  return Boolean(rule);
};

export const sendScheduledCheckinPrompts = async (bot: Bot<any>) => {
  const users = await prisma.user.findMany({ select: { id: true, tgUserId: true, timezone: true } });

  for (const user of users) {
    const now = DateTime.now().setZone(user.timezone);
    const isMorning = isWithinCronWindow(now, 8, 30);
    const isEvening = isWithinCronWindow(now, 22, 0);

    if (!isMorning && !isEvening) {
      continue;
    }

    const dayKey = now.toFormat("yyyy-LL-dd");
    const alreadySent = await hasPromptSent(prisma, user.id, dayKey, isMorning);
    if (alreadySent) {
      continue;
    }

    try {
      await bot.api.sendMessage(
        Number(user.tgUserId),
        "Как твое самочувствие сегодня?",
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Голосовое", callback_data: `mood:voice:${isMorning ? "morning" : "evening"}` },
                { text: "Текст", callback_data: `mood:text:${isMorning ? "morning" : "evening"}` },
              ],
            ],
          },
        }
      );
      await upsertPromptSent(prisma, user.id, dayKey, isMorning);
    } catch (error) {
      console.error(`[MoodCron] failed to send prompt to user ${user.tgUserId}`, error);
    }
  }
};
