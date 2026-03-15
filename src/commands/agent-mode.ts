import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types/bot-context.types";
import type { AgentMode } from "../types/llm.types";
import {
  getAgentModeDescription,
  getAgentModeForUser,
  getAgentModeLabel,
  setAgentModeForUser,
} from "../services/agent-mode.service";
import { ensureUserByTelegramId } from "../services/user.service";
import { safeReply } from "../utils/telegram";

const AGENT_MODES: AgentMode[] = ["FOUNDATION", "PRE_STARTUP", "STARTUP"];

const buildModeKeyboard = (currentMode: AgentMode) => {
  const keyboard = new InlineKeyboard();
  for (const mode of AGENT_MODES) {
    const prefix = mode === currentMode ? "● " : "";
    keyboard.text(`${prefix}${getAgentModeLabel(mode)}`, `agent_mode:set:${mode}`).row();
  }
  return keyboard;
};

export const agentModeCommand = async (ctx: BotContext): Promise<void> => {
  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const user = await ensureUserByTelegramId(tgUserId);
  const currentMode = await getAgentModeForUser(user.id);

  const text = [
    "Выбери режим агента:",
    "",
    `Текущий режим: ${getAgentModeLabel(currentMode)}`,
    getAgentModeDescription(currentMode),
  ].join("\n");

  await safeReply(ctx, text);
  await ctx.reply("Режимы:", { reply_markup: buildModeKeyboard(currentMode) });
};

export const agentModeCallbackHandler = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("agent_mode:set:")) {
    return;
  }

  const tgUserId = String(ctx.from?.id ?? "");
  if (!tgUserId) return;

  const rawMode = data.replace("agent_mode:set:", "").trim();
  if (!AGENT_MODES.includes(rawMode as AgentMode)) {
    await ctx.answerCallbackQuery({ text: "Некорректный режим" });
    return;
  }

  const mode = rawMode as AgentMode;
  const user = await ensureUserByTelegramId(tgUserId);
  await setAgentModeForUser(user.id, mode);

  await ctx.answerCallbackQuery({ text: `Режим: ${getAgentModeLabel(mode)}` });
  await safeReply(
    ctx,
    `Режим агента переключен: ${getAgentModeLabel(mode)}\n${getAgentModeDescription(mode)}`
  );
};
