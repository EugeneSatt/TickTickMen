import "dotenv/config";
import { conversations, createConversation } from "@grammyjs/conversations";
import { Bot, GrammyError } from "grammy";
import { applyCategoriesCommand } from "./commands/apply-categories";
import {
  moodCallbackHandler,
  moodPromptCommand,
  textCheckinConversationMiddleware,
  voiceMoodMessageHandler,
} from "./commands/mood";
import { planCommand } from "./commands/plan";
import { projectFocusCallbackHandler, projectFocusCommand } from "./commands/project-focus";
import { projectHelpCommand } from "./commands/project-help";
import { projectListCommand } from "./commands/project-list";
import {
  projectNoteCallbackHandler,
  projectNoteCommand,
  projectNoteTextHandler,
} from "./commands/project-note";
import {
  projectNewCommand,
  projectNewConversation,
  projectReviewCommand,
  projectReviewConversation,
} from "./commands/project-conversations";
import {
  projectUpdateCallbackHandler,
  projectUpdateCommand,
  projectUpdateTextHandler,
} from "./commands/project-update";
import { projectViewCommand } from "./commands/project-view";
import { reviewCommand } from "./commands/review";
import { summaryDailyCommand, summaryWeeklyCommand } from "./commands/summary";
import { startCommand } from "./commands/start";
import { taskDoneCallbackHandler, taskDoneCommand } from "./commands/task-done";
import { taskProjectCommand } from "./commands/task-project";
import { tasksCommand } from "./commands/tasks";
import { talkCommand } from "./commands/talk";

const token = process.env.BOT_TOKEN;
const allowedTgUserId = process.env.ALLOWED_TG_USER_ID?.trim() || "841208806";

if (!token) {
  throw new Error("Missing BOT_TOKEN environment variable");
}

const bot = new Bot(token);

bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id ? String(ctx.from.id) : null;
  if (fromId && fromId !== allowedTgUserId) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Доступ ограничен" });
    }
    return;
  }
  await next();
});

bot.use(conversations() as any);
bot.use(textCheckinConversationMiddleware as any);
bot.use(createConversation(projectNewConversation as any) as any);
bot.use(createConversation(projectReviewConversation as any) as any);

bot.command("start", startCommand);
bot.command("tasks", tasksCommand);
bot.command("talk", talkCommand);
bot.command("plan", planCommand);
bot.command("apply_categories", applyCategoriesCommand);
bot.command("review", reviewCommand);
bot.command("summary_daily", summaryDailyCommand);
bot.command("summary_weekly", summaryWeeklyCommand);
bot.command("mood", moodPromptCommand as any);
bot.command("project_new", projectNewCommand as any);
bot.command("project_view", projectViewCommand as any);
bot.command("project_list", projectListCommand as any);
bot.command("project_update", projectUpdateCommand as any);
bot.command("project_focus", projectFocusCommand as any);
bot.command("project_review", projectReviewCommand as any);
bot.command("project_note", projectNoteCommand as any);
bot.command("project_help", projectHelpCommand as any);
bot.command("task_project", taskProjectCommand as any);
bot.command("task_done", taskDoneCommand as any);
bot.callbackQuery(/^mood:/, moodCallbackHandler as any);
bot.callbackQuery(/^project_update:/, projectUpdateCallbackHandler as any);
bot.callbackQuery(/^project_focus:set:/, projectFocusCallbackHandler as any);
bot.callbackQuery(/^project_note:set:/, projectNoteCallbackHandler as any);
bot.callbackQuery(/^task_done:/, taskDoneCallbackHandler as any);
bot.on("message:text", projectUpdateTextHandler as any);
bot.on("message:text", projectNoteTextHandler as any);
bot.on("message:voice", voiceMoodMessageHandler as any);

bot.catch((error) => {
  console.error("[Bot] Global error handler", {
    error: error.error,
    update: error.ctx.update,
  });
});

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const setupLongPolling = async (): Promise<void> => {
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log("[Bot] Webhook cleared, long polling enabled");
  } catch (error: unknown) {
    console.error("[Bot] deleteWebhook failed, continuing with polling", error);
  }
};

const isConflictError = (error: unknown): boolean =>
  error instanceof GrammyError &&
  error.error_code === 409 &&
  error.description.includes("terminated by other getUpdates request");

const startBot = async (): Promise<void> => {
  await setupLongPolling();

  const maxAttempts = 2;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        console.log(`[Bot] Starting Telegram bot... (attempt ${attempt}/${maxAttempts})`);
        await bot.start();
        return;
      } catch (error: unknown) {
        if (attempt < maxAttempts && isConflictError(error)) {
          console.error("[Bot] 409 conflict detected, retrying after webhook reset");
          await setupLongPolling();
          await sleep(1200);
          continue;
        }
        throw error;
      }
    }
  } catch (error: unknown) {
    console.error("[Bot] Failed to start bot", error);
    process.exit(1);
  }
};

void startBot();
