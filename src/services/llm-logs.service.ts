import { Bot } from "grammy";

const CHUNK_LIMIT = 3500;

const chunkText = (text: string, chunkSize: number): string[] => {
  if (text.length <= chunkSize) {
    return [text];
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
};

export const sendPromptLog = async (params: {
  source: string;
  model: string;
  system: string;
  user: string;
}): Promise<void> => {
  const token = process.env.LOGS_BOT_TOKEN?.trim();
  const chatId =
    process.env.LOGS_CHAT_ID?.trim() ||
    process.env.ALLOWED_TG_USER_ID?.trim() ||
    "841208806";

  if (!token || !chatId) {
    return;
  }

  try {
    const bot = new Bot(token);
    const header = [
      `LLM Prompt Log`,
      `source: ${params.source}`,
      `model: ${params.model}`,
      `time: ${new Date().toISOString()}`,
    ].join("\n");

    await bot.api.sendMessage(Number(chatId), header);

    const systemChunks = chunkText(params.system, CHUNK_LIMIT);
    for (let i = 0; i < systemChunks.length; i += 1) {
      await bot.api.sendMessage(Number(chatId), `SYSTEM [${i + 1}/${systemChunks.length}]\n${systemChunks[i]}`);
    }

    const userChunks = chunkText(params.user, CHUNK_LIMIT);
    for (let i = 0; i < userChunks.length; i += 1) {
      await bot.api.sendMessage(Number(chatId), `USER [${i + 1}/${userChunks.length}]\n${userChunks[i]}`);
    }
  } catch (error: unknown) {
    console.error("[LLMLogs] Failed to send prompt log", error);
  }
};

