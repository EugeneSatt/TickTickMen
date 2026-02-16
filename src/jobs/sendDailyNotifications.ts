import "dotenv/config";
import { Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { sendScheduledCheckinPrompts } from "../services/emotion.service";
import { recomputeDailyFeatures } from "../services/features.service";
import { sendCalendarWeekReviewToAllUsers } from "../services/planning.service";
import { syncFromTickTickToAllUsers } from "../services/sync-orchestrator.service";
import { CRON_WINDOW_MINUTES, isWithinCronWindow } from "../utils/cron-time-window";

const MOSCOW_TZ = "Europe/Moscow";

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
  console.log(
    `[CronJob] now(msk)=${nowMoscow.toISO()} hhmm=${nowMoscow.toFormat("HH:mm")} weekday=${nowMoscow.weekday} window=${CRON_WINDOW_MINUTES}m`
  );
  const bot = createBot();

  if (bot) {
    await sendScheduledCheckinPrompts(bot as any);
    console.log("[CronJob] Check-in notifications processed");
  } else {
    console.log("[CronJob] Skipping check-in notifications (no BOT_TOKEN)");
  }

  const shouldRecompute = isWithinCronWindow(nowMoscow, 0, 5);
  console.log(`[CronJob] daily features recompute check: ${shouldRecompute ? "RUN" : "SKIP"}`);
  if (shouldRecompute) {
    await runDailyFeaturesRecompute();
  }

  const shouldWeeklyReview = isMonday(nowMoscow) && isWithinCronWindow(nowMoscow, 11, 0);
  console.log(
    `[CronJob] weekly review check: ${shouldWeeklyReview ? "RUN" : "SKIP"} (hasBot=${Boolean(bot)})`
  );
  if (shouldWeeklyReview && bot) {
    await sendCalendarWeekReviewToAllUsers(bot as any);
    console.log("[CronJob] Weekly calendar reviews processed");
  }

  const shouldNightSync = isWithinCronWindow(nowMoscow, 2, 0);
  console.log(`[CronJob] night ticktick sync check: ${shouldNightSync ? "RUN" : "SKIP"}`);
  if (shouldNightSync) {
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
