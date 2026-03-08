import axios, { AxiosError } from "axios";
import { Prisma } from "@prisma/client";
import { Bot } from "grammy";
import { DateTime } from "luxon";
import { LLM_PROMPTS, SYSTEM_PROMPTS } from "../config/llm-prompts";
import { prisma } from "../db/prisma";
import { isWithinCronWindow, CRON_WINDOW_MINUTES } from "../utils/cron-time-window";
import { ensureUserByTelegramId } from "./user.service";
import { sendPromptLog } from "./llm-logs.service";

const NEWS_SCHEDULE_KEY_PREFIX = "news_digest_schedule:";
const NEWS_LAST_TOPIC_KEY_PREFIX = "news_digest_last_topic:";
const COMET_API_URL = "https://api.cometapi.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 90_000;
const START_MIN = 8 * 60; // 08:00
const END_MIN_EXCLUSIVE = 23 * 60; // before 23:00
const MAX_MESSAGE_LEN = 3900;
const MOSCOW_TZ = "Europe/Moscow";

interface NewsScheduleValue {
  slots: string[];
  sent: string[];
  usedTopics: string[];
  createdAt: string;
}

interface CometResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const getCometModel = (): string =>
  (process.env.COMET_MODEL?.trim() || process.env.COMETAPI_MODEL?.trim() || "gemini-2.5-pro").trim();

const getTimeoutMs = (): number => {
  const raw = Number(process.env.COMET_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(raw);
};

const getChatId = (): string => process.env.LOGS_CHAT_ID?.trim() || process.env.ALLOWED_TG_USER_ID?.trim() || "841208806";

const getLogsBotToken = (): string | null => {
  const token = process.env.LOGS_BOT_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
};

const createLogsBot = (): Bot | null => {
  const token = getLogsBotToken();
  if (!token) {
    return null;
  }
  return new Bot(token);
};

const parseTopic = (text: string): string | null => {
  const match = text.match(/(?:^|\n)Тема:\s*(.+)\s*$/m);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim().toLowerCase();
};

const normalizeText = (text: string): string => text.replace(/\r\n/g, "\n").trim();

const truncateForTelegram = (text: string): string =>
  text.length <= MAX_MESSAGE_LEN ? text : `${text.slice(0, MAX_MESSAGE_LEN - 1)}…`;

const scheduleKeyForDay = (userId: string, dayKey: string): string =>
  `${NEWS_SCHEDULE_KEY_PREFIX}${userId}:${dayKey}`;

const lastTopicKey = (userId: string): string => `${NEWS_LAST_TOPIC_KEY_PREFIX}${userId}`;

const generateRandomSlots = (): string[] => {
  const targetCount = Math.random() < 0.5 ? 4 : 5;
  const usedMinutes = new Set<number>();

  while (usedMinutes.size < targetCount) {
    const randomMinute = Math.floor(Math.random() * (END_MIN_EXCLUSIVE - START_MIN)) + START_MIN;
    usedMinutes.add(randomMinute);
  }

  return Array.from(usedMinutes)
    .sort((a, b) => a - b)
    .map((total) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
};

const readSchedule = async (userId: string, dayKey: string): Promise<NewsScheduleValue | null> => {
  const key = scheduleKeyForDay(userId, dayKey);
  const rule = await prisma.userRule.findUnique({
    where: { key },
    select: { value: true, isActive: true },
  });
  if (!rule?.isActive) {
    return null;
  }
  return (rule.value as unknown) as NewsScheduleValue;
};

const saveSchedule = async (userId: string, dayKey: string, value: NewsScheduleValue): Promise<void> => {
  const key = scheduleKeyForDay(userId, dayKey);
  await prisma.userRule.upsert({
    where: { key },
    update: {
      userId,
      isActive: true,
      value: (value as unknown) as Prisma.InputJsonValue,
    },
    create: {
      userId,
      key,
      isActive: true,
      value: (value as unknown) as Prisma.InputJsonValue,
    },
  });
};

const getOrCreateSchedule = async (userId: string, dayKey: string): Promise<NewsScheduleValue> => {
  const existing = await readSchedule(userId, dayKey);
  if (existing) {
    return existing;
  }

  const created: NewsScheduleValue = {
    slots: generateRandomSlots(),
    sent: [],
    usedTopics: [],
    createdAt: new Date().toISOString(),
  };
  await saveSchedule(userId, dayKey, created);
  return created;
};

const getLastTopic = async (userId: string): Promise<string | null> => {
  const rule = await prisma.userRule.findUnique({
    where: { key: lastTopicKey(userId) },
    select: { value: true, isActive: true },
  });
  if (!rule?.isActive || typeof rule.value !== "object" || !rule.value) {
    return null;
  }
  const topic = (rule.value as { topic?: unknown }).topic;
  return typeof topic === "string" && topic.trim() ? topic.trim().toLowerCase() : null;
};

const setLastTopic = async (userId: string, topic: string): Promise<void> => {
  await prisma.userRule.upsert({
    where: { key: lastTopicKey(userId) },
    update: {
      userId,
      isActive: true,
      value: {
        topic: topic.toLowerCase(),
        updatedAt: new Date().toISOString(),
      },
    },
    create: {
      userId,
      key: lastTopicKey(userId),
      isActive: true,
      value: {
        topic: topic.toLowerCase(),
        updatedAt: new Date().toISOString(),
      },
    },
  });
};

const shouldSendForSlot = (now: DateTime, slot: string): boolean => {
  const [hh, mm] = slot.split(":").map((value) => Number(value));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    return false;
  }
  return isWithinCronWindow(now, hh, mm, CRON_WINDOW_MINUTES);
};

const formatAxiosError = (error: AxiosError): string => {
  const details =
    typeof error.response?.data === "string" ? error.response.data : JSON.stringify(error.response?.data ?? {});
  return `status=${error.response?.status ?? "NO_STATUS"} code=${error.code ?? "NO_CODE"} message="${error.message}" details=${details}`;
};

const buildUserContext = (params: {
  nowMoscow: string;
  lastTopic: string | null;
  usedToday: string[];
}): string => {
  return [
    "Контекст генерации:",
    `Текущая дата/время (Москва): ${params.nowMoscow}`,
    `Последняя тема: ${params.lastTopic ?? "нет"}`,
    `Темы уже использованы сегодня: ${params.usedToday.length ? params.usedToday.join(", ") : "нет"}`,
    "Сгенерируй один выпуск строго по формату.",
  ].join("\n");
};

const generateNewsDigest = async (context: string): Promise<string> => {
  const apiKey = process.env.COMET_API_KEY ?? process.env.COMETAPI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("Missing COMET_API_KEY/COMETAPI_API_KEY");
  }
  const model = getCometModel();
  const systemPrompt = LLM_PROMPTS.newsDigestRu;

  await sendPromptLog({
    source: "news-digest",
    model,
    system: systemPrompt,
    user: context,
  });

  try {
    const response = await axios.post<CometResponse>(
      COMET_API_URL,
      {
        model,
        messages: [
          { role: SYSTEM_PROMPTS.role, content: systemPrompt },
          { role: "user", content: context },
        ],
        temperature: 0.6,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: getTimeoutMs(),
      }
    );

    const content = response.data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Empty news response from LLM");
    }
    return truncateForTelegram(normalizeText(content));
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Comet API request failed (${formatAxiosError(error)})`);
    }
    throw error;
  }
};

export const processNewsDigestPrompts = async (): Promise<void> => {
  const bot = createLogsBot();
  if (!bot) {
    console.log("[NewsDigest] skipped: LOGS_BOT_TOKEN is not set");
    return;
  }

  const tgUserId = getChatId();
  const user = await ensureUserByTelegramId(tgUserId);
  const now = DateTime.now().setZone(MOSCOW_TZ);
  const userNow = now.setZone(user.timezone || MOSCOW_TZ);
  const dayKey = userNow.toFormat("yyyy-LL-dd");

  const schedule = await getOrCreateSchedule(user.id, dayKey);
  const pendingSlot = schedule.slots.find((slot) => !schedule.sent.includes(slot) && shouldSendForSlot(userNow, slot));

  if (!pendingSlot) {
    console.log("[NewsDigest] no due slot", {
      userId: user.id,
      tgUserId,
      dayKey,
      slots: schedule.slots,
      sent: schedule.sent,
    });
    return;
  }

  const lastTopic = await getLastTopic(user.id);
  const context = buildUserContext({
    nowMoscow: now.toISO() ?? now.toFormat("yyyy-LL-dd HH:mm"),
    lastTopic,
    usedToday: schedule.usedTopics,
  });

  try {
    const text = await generateNewsDigest(context);
    await bot.api.sendMessage(Number(tgUserId), text);

    schedule.sent.push(pendingSlot);
    const parsedTopic = parseTopic(text);
    if (parsedTopic) {
      schedule.usedTopics = Array.from(new Set([...schedule.usedTopics, parsedTopic])).slice(-10);
      await setLastTopic(user.id, parsedTopic);
    }
    await saveSchedule(user.id, dayKey, schedule);

    console.log("[NewsDigest] sent", {
      userId: user.id,
      tgUserId,
      dayKey,
      slot: pendingSlot,
      sentCountToday: schedule.sent.length,
      topic: parsedTopic,
    });
  } catch (error: unknown) {
    console.error("[NewsDigest] failed to send", {
      userId: user.id,
      tgUserId,
      dayKey,
      slot: pendingSlot,
      error,
    });
  }
};
