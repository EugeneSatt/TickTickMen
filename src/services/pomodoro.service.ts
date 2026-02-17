import { Prisma, type User } from "@prisma/client";
import type { Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { CRON_WINDOW_MINUTES, isWithinCronWindow } from "../utils/cron-time-window";

const PROMPT_TEXT = "Юджин Сергеевич, вы уже включали помодоро?";
const POMODORO_KEY_PREFIX = "pomodoro_schedule:";
const TARGET_COUNT = 3;
const START_MIN = 10 * 60; // 10:00
const END_MIN_EXCLUSIVE = 17 * 60; // before 17:00

interface PomodoroScheduleValue {
  slots: string[];
  sent: string[];
  stopped: boolean;
  createdAt: string;
  stoppedAt?: string;
}

const keyForDay = (userId: string, dayKey: string): string => `${POMODORO_KEY_PREFIX}${userId}:${dayKey}`;

const generateRandomSlots = (): string[] => {
  const minutes = new Set<number>();
  while (minutes.size < TARGET_COUNT) {
    const randomMinute = Math.floor(Math.random() * (END_MIN_EXCLUSIVE - START_MIN)) + START_MIN;
    minutes.add(randomMinute);
  }

  return Array.from(minutes)
    .sort((a, b) => a - b)
    .map((total) => {
      const hh = String(Math.floor(total / 60)).padStart(2, "0");
      const mm = String(total % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    });
};

const readSchedule = async (userId: string, dayKey: string): Promise<PomodoroScheduleValue | null> => {
  const rule = await prisma.userRule.findUnique({
    where: { key: keyForDay(userId, dayKey) },
    select: { value: true, isActive: true },
  });
  if (!rule?.isActive) {
    return null;
  }
  return (rule.value as unknown) as PomodoroScheduleValue;
};

const saveSchedule = async (userId: string, dayKey: string, value: PomodoroScheduleValue): Promise<void> => {
  const key = keyForDay(userId, dayKey);
  await prisma.userRule.upsert({
    where: { key },
    update: {
      userId,
      isActive: true,
      value: (value as unknown) as Prisma.InputJsonValue,
    },
    create: {
      key,
      userId,
      isActive: true,
      value: (value as unknown) as Prisma.InputJsonValue,
    },
  });
};

const getOrCreateSchedule = async (userId: string, dayKey: string): Promise<PomodoroScheduleValue> => {
  const existing = await readSchedule(userId, dayKey);
  if (existing) {
    return existing;
  }

  const created: PomodoroScheduleValue = {
    slots: generateRandomSlots(),
    sent: [],
    stopped: false,
    createdAt: new Date().toISOString(),
  };
  await saveSchedule(userId, dayKey, created);
  return created;
};

const shouldSendForSlot = (userNow: DateTime, slot: string): boolean => {
  const [hh, mm] = slot.split(":").map((v) => Number(v));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    return false;
  }
  return isWithinCronWindow(userNow, hh, mm, CRON_WINDOW_MINUTES);
};

export const processPomodoroPromptsForAllUsers = async (bot: Bot): Promise<void> => {
  const users = await prisma.user.findMany({
    select: { id: true, tgUserId: true, timezone: true },
  });

  let sentCount = 0;
  let stoppedCount = 0;
  let skippedNoWindow = 0;

  for (const user of users) {
    const userNow = DateTime.now().setZone(user.timezone);
    const dayKey = userNow.toFormat("yyyy-LL-dd");
    const schedule = await getOrCreateSchedule(user.id, dayKey);

    if (schedule.stopped) {
      stoppedCount += 1;
      continue;
    }

    const pendingSlot = schedule.slots.find(
      (slot) => !schedule.sent.includes(slot) && shouldSendForSlot(userNow, slot)
    );

    if (!pendingSlot) {
      skippedNoWindow += 1;
      continue;
    }

    try {
      await bot.api.sendMessage(Number(user.tgUserId), PROMPT_TEXT, {
        reply_markup: {
          inline_keyboard: [[{ text: "Стоп", callback_data: "pomodoro:stop" }]],
        },
      });

      schedule.sent.push(pendingSlot);
      await saveSchedule(user.id, dayKey, schedule);
      sentCount += 1;

      console.log("[Pomodoro] prompt sent", {
        userId: user.id,
        tgUserId: user.tgUserId,
        dayKey,
        slot: pendingSlot,
        sentCountToday: schedule.sent.length,
      });
    } catch (error: unknown) {
      console.error("[Pomodoro] failed to send prompt", {
        userId: user.id,
        tgUserId: user.tgUserId,
        dayKey,
        slot: pendingSlot,
        error,
      });
    }
  }

  console.log("[Pomodoro] processing finished", {
    users: users.length,
    sentCount,
    stoppedCount,
    skippedNoWindow,
  });
};

export const stopPomodoroForToday = async (user: Pick<User, "id" | "timezone">): Promise<void> => {
  const now = DateTime.now().setZone(user.timezone);
  const dayKey = now.toFormat("yyyy-LL-dd");
  const schedule = await getOrCreateSchedule(user.id, dayKey);
  schedule.stopped = true;
  schedule.stoppedAt = new Date().toISOString();
  await saveSchedule(user.id, dayKey, schedule);
};
