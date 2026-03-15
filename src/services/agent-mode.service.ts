import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { AgentMode } from "../types/llm.types";

const AGENT_MODE_RULE_KEY = "agent_mode";
export const DEFAULT_AGENT_MODE: AgentMode = "FOUNDATION";

const isAgentMode = (value: unknown): value is AgentMode =>
  value === "FOUNDATION" || value === "PRE_STARTUP" || value === "STARTUP";

export const getAgentModeLabel = (mode: AgentMode): string => {
  if (mode === "FOUNDATION") {
    return "Foundation";
  }
  if (mode === "PRE_STARTUP") {
    return "Pre-Startup";
  }
  return "Startup";
};

export const getAgentModeDescription = (mode: AgentMode): string => {
  if (mode === "FOUNDATION") {
    return "Стабильность, система жизни, накопление капитала, расчистка хаоса.";
  }
  if (mode === "PRE_STARTUP") {
    return "Переходный этап: база сохраняется, но уже есть умеренный фокус на запуск.";
  }
  return "Предпринимательский режим: больше веса у MONEY, GROWTH, запуска и рынка.";
};

export const getAgentModeForUser = async (userId: string): Promise<AgentMode> => {
  const rule = await prisma.userRule.findUnique({
    where: { key: `${AGENT_MODE_RULE_KEY}:${userId}` },
    select: { value: true, isActive: true },
  });

  if (!rule?.isActive) {
    return DEFAULT_AGENT_MODE;
  }

  const value = rule.value as { mode?: unknown } | null;
  return isAgentMode(value?.mode) ? value.mode : DEFAULT_AGENT_MODE;
};

export const setAgentModeForUser = async (userId: string, mode: AgentMode): Promise<void> => {
  await prisma.userRule.upsert({
    where: { key: `${AGENT_MODE_RULE_KEY}:${userId}` },
    update: {
      userId,
      isActive: true,
      value: {
        mode,
        updatedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
    create: {
      key: `${AGENT_MODE_RULE_KEY}:${userId}`,
      userId,
      isActive: true,
      value: {
        mode,
        updatedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
};
