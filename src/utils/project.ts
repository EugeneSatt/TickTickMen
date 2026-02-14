import { DateTime } from "luxon";
import { ProjectStatus, type Project, type ProjectNote } from "@prisma/client";

export const isSkipValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === "skip" || normalized === "-";
};

export const parseProjectStatus = (value: string): ProjectStatus | null => {
  const raw = value.trim().toUpperCase();
  if (["IDEA", "ACTIVE", "PRE_LAUNCH", "PAUSED", "DONE"].includes(raw)) {
    return raw as ProjectStatus;
  }
  return null;
};

export const parseHorizonMonths = (value: string): number | null => {
  if (isSkipValue(value)) {
    return null;
  }
  const n = Number(value.trim());
  if (![3, 6, 12].includes(n)) {
    throw new Error("Горизонт должен быть 3, 6 или 12");
  }
  return n;
};

export const parseNonNegativeNumber = (value: string, fieldName: string): number | null => {
  if (isSkipValue(value)) {
    return null;
  }
  const n = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${fieldName} должно быть числом >= 0`);
  }
  return n;
};

export const parseScale1to5 = (value: string, fieldName: string): number | null => {
  if (isSkipValue(value)) {
    return null;
  }
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error(`${fieldName} должно быть от 1 до 5`);
  }
  return n;
};

export const parseMaybeText = (value: string): string | null => {
  if (isSkipValue(value)) {
    return null;
  }
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
};

const formatDate = (date: Date): string => DateTime.fromJSDate(date).toFormat("dd.LL.yyyy HH:mm");

export const formatProjectCard = (
  project: Project,
  notes: ProjectNote[] = []
): string => {
  const header = [
    `📌 ${project.name}`,
    `Статус: ${project.status}`,
    `Горизонт: ${project.horizonMonths ?? "—"}${project.horizonMonths ? " мес" : ""}`,
    `Цель дохода: ${project.revenueGoal ?? "—"}`,
    `Риск: ${project.riskLevel ?? "—"}${project.riskLevel ? "/5" : ""}`,
    `Мотивация: ${project.energyScore ?? "—"}${project.energyScore ? "/5" : ""}`,
    `Фокус недели: ${project.weeklyFocus ? "✅" : "❌"}`,
    "",
    `Видение: ${project.vision ?? "—"}`,
    `Метрика: ${project.metric ?? "—"}`,
  ].join("\n");

  if (!notes.length) {
    return `${header}\n\nПоследние заметки:\n- Нет заметок`;
  }

  const noteLines = notes.map((note) => `- (${formatDate(note.createdAt)}) ${note.text}`);
  return `${header}\n\nПоследние заметки:\n${noteLines.join("\n")}`;
};

export const parseProjectUpdatePairs = (pairs: string[]) => {
  const knownKeys = new Set([
    "status",
    "vision",
    "metric",
    "horizonMonths",
    "revenueGoal",
    "riskLevel",
    "energyScore",
    "weeklyFocus",
  ]);

  const patch: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) {
      ignored.push(pair);
      continue;
    }

    const key = pair.slice(0, idx).trim();
    const rawValue = pair.slice(idx + 1).trim();
    if (!knownKeys.has(key)) {
      ignored.push(key);
      continue;
    }

    if (key === "status") {
      const value = parseProjectStatus(rawValue);
      if (!value) {
        throw new Error("status должен быть IDEA|ACTIVE|PRE_LAUNCH|PAUSED|DONE");
      }
      patch.status = value;
      continue;
    }

    if (key === "vision" || key === "metric") {
      patch[key] = parseMaybeText(rawValue);
      continue;
    }

    if (key === "horizonMonths") {
      patch.horizonMonths = parseHorizonMonths(rawValue);
      continue;
    }

    if (key === "revenueGoal") {
      patch.revenueGoal = parseNonNegativeNumber(rawValue, "revenueGoal");
      continue;
    }

    if (key === "riskLevel") {
      patch.riskLevel = parseScale1to5(rawValue, "riskLevel");
      continue;
    }

    if (key === "energyScore") {
      patch.energyScore = parseScale1to5(rawValue, "energyScore");
      continue;
    }

    if (key === "weeklyFocus") {
      patch.weeklyFocus = ["1", "true", "yes", "да"].includes(rawValue.toLowerCase());
      continue;
    }
  }

  return { patch, ignored };
};

export const parseCommandArgs = (text: string): string[] => {
  return text.trim().split(/\s+/).slice(1);
};
