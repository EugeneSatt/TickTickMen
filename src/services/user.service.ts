import { prisma } from "../db/prisma";

const APP_TIMEZONE = process.env.APP_TIMEZONE?.trim() || "Europe/Moscow";

export const ensureUserByTelegramId = async (tgUserId: string) => {
  return prisma.user.upsert({
    where: { tgUserId },
    update: { timezone: APP_TIMEZONE },
    create: { tgUserId, timezone: APP_TIMEZONE },
  });
};
