import "dotenv/config";
import { prisma } from "../db/prisma";
import { runDailyNotifications } from "./sendDailyNotifications";

async function main() {
  try {
    await runDailyNotifications();
  } catch (error: unknown) {
    console.error("Cron job failed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    if (process.exitCode && process.exitCode !== 0) {
      process.exit(1);
    }
    process.exit(0);
  }
}

void main();

