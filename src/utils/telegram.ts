import { HttpError, type Context } from "grammy";

const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNABORTED"]);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRetryableTelegramNetworkError = (error: unknown): boolean => {
  if (!(error instanceof HttpError)) {
    return false;
  }

  const innerError = error.error as NodeJS.ErrnoException | undefined;
  return Boolean(innerError?.code && RETRYABLE_ERROR_CODES.has(innerError.code));
};

export const safeReply = async (ctx: Context, text: string): Promise<void> => {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await ctx.reply(text);
      return;
    } catch (error: unknown) {
      if (attempt < maxAttempts && isRetryableTelegramNetworkError(error)) {
        console.error(`[Bot] Telegram sendMessage network error, retry ${attempt}/${maxAttempts}`);
        await sleep(800);
        continue;
      }
      throw error;
    }
  }
};
