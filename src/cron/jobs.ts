import cron from "node-cron";
import type { Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { sendScheduledCheckinPrompts } from "../services/emotion.service";
import { recomputeDailyFeatures } from "../services/features.service";
import { sendCalendarWeekReviewToAllUsers } from "../services/planning.service";
import { syncFromTickTickToAllUsers } from "../services/sync-orchestrator.service";

export const startCronJobs = (bot: Bot<any>): void => {
  if (process.env.ENABLE_CRON !== "true") {
    console.log("[Cron] ENABLE_CRON is not true, cron jobs are disabled");
    return;
  }

  cron.schedule("5 0 * * *", async () => {
    console.log("[Cron] Daily features recompute started");
    const users = await prisma.user.findMany({ select: { id: true, timezone: true } });

    for (const user of users) {
      const day = DateTime.now().setZone(user.timezone).startOf("day");
      await recomputeDailyFeatures(user.id, day);
    }

    console.log(`[Cron] Daily features recompute completed for ${users.length} users`);
  });

  cron.schedule("* * * * *", async () => {
    try {
      await sendScheduledCheckinPrompts(bot);
    } catch (error) {
      console.error("[Cron] Mood prompts job failed", error);
    }
  });

  cron.schedule(
    "0 2 * * *",
    async () => {
      try {
        console.log("[Cron] Night TickTick sync started");
        const result = await syncFromTickTickToAllUsers();
        if (!result.ok) {
          console.error("[Cron] Night TickTick sync skipped:", result.authHint);
          return;
        }
        console.log(
          `[Cron] Night TickTick sync completed: users=${result.usersSynced}, tasks=${result.tasksCount}`
        );
      } catch (error) {
        console.error("[Cron] Night TickTick sync failed", error);
      }
    },
    { timezone: "Europe/Moscow" }
  );

  cron.schedule(
    "0 11 * * 1",
    async () => {
      try {
        await sendCalendarWeekReviewToAllUsers(bot);
      } catch (error) {
        console.error("[Cron] Weekly calendar review job failed", error);
      }
    },
    { timezone: "Europe/Moscow" }
  );

  console.log("[Cron] Jobs scheduled");
};
