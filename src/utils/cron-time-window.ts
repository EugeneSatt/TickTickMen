import { DateTime } from "luxon";

const DEFAULT_CRON_WINDOW_MINUTES = 5;

const parseCronWindowMinutes = (rawValue: string | undefined): number => {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CRON_WINDOW_MINUTES;
  }
  return parsed;
};

export const CRON_WINDOW_MINUTES = parseCronWindowMinutes(process.env.CRON_WINDOW_MINUTES);

export const isWithinCronWindow = (
  now: DateTime,
  targetHour: number,
  targetMinute: number,
  windowMinutes: number = CRON_WINDOW_MINUTES
): boolean => {
  const safeWindow = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : DEFAULT_CRON_WINDOW_MINUTES;
  const target = now.set({
    hour: targetHour,
    minute: targetMinute,
    second: 0,
    millisecond: 0,
  });
  const diffMinutes = now.diff(target, "minutes").minutes;
  return diffMinutes >= 0 && diffMinutes < safeWindow;
};
