import "dotenv/config";
import { Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { sendScheduledCheckinPrompts } from "../services/emotion.service";
import { recomputeDailyFeatures } from "../services/features.service";
import { sendCalendarWeekReviewToAllUsers } from "../services/planning.service";
import { syncFromTickTickToAllUsers } from "../services/sync-orchestrator.service";

const MOSCOW_TZ = "Europe/Moscow";

const isTime = (now: DateTime, hh: number, mm: number): boolean =>
  now.hour === hh && now.minute === mm;

const isMonday = (now: DateTime): boolean => now.weekday === 1;

const createBot = (): Bot | null => {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    console.error("[CronJob] Missing BOT_TOKEN");
    return null;
  }
  return new Bot(token);
};

const runDailyFeaturesRecompute = async (): Promise<void> => {
  const users = await prisma.user.findMany({ select: { id: true, timezone: true } });
  for (const user of users) {
    const day = DateTime.now().setZone(user.timezone).startOf("day");
    await recomputeDailyFeatures(user.id, day);
  }
  console.log(`[CronJob] Daily features recomputed for ${users.length} users`);
};

export async function runDailyNotifications(): Promise<void> {
  console.log("[CronJob] Daily notification job started");

  const nowMoscow = DateTime.now().setZone(MOSCOW_TZ);
  const bot = createBot();

  if (bot) {
    await sendScheduledCheckinPrompts(bot as any);
    console.log("[CronJob] Check-in notifications processed");
  } else {
    console.log("[CronJob] Skipping check-in notifications (no BOT_TOKEN)");
  }

  if (isTime(nowMoscow, 0, 5)) {
    await runDailyFeaturesRecompute();
  }

  if (isMonday(nowMoscow) && isTime(nowMoscow, 11, 0) && bot) {
    await sendCalendarWeekReviewToAllUsers(bot as any);
    console.log("[CronJob] Weekly calendar reviews processed");
  }

  if (isTime(nowMoscow, 2, 0)) {
    const result = await syncFromTickTickToAllUsers();
    if (!result.ok) {
      console.error("[CronJob] Night TickTick sync skipped:", result.authHint);
    } else {
      console.log(
        `[CronJob] Night TickTick sync completed: users=${result.usersSynced}, tasks=${result.tasksCount}`
      );
    }
  }

  console.log("[CronJob] Daily notification job finished");
}

