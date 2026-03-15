import type { Context } from "grammy";
import { safeReply } from "../utils/telegram";

export const startCommand = async (ctx: Context): Promise<void> => {
  const text = [
    "👋 Добро пожаловать! Доступные команды:",
    "",
    "/tasks — синхронизирует задачи из TickTick и показывает по папкам.",
    "/plan — строит план на день через LLM и сохраняет предложения категорий.",
    "/agent_mode — выбрать режим агента под текущий жизненный этап.",
    "/apply_categories — применяет предложенные категории к задачам.",
    "/review — статистика за последние 7 дней от текущего момента.",
    "/summary_daily — краткая дневная сводка на русском.",
    "/summary_weekly — недельная сводка на русском.",
    "/mood — ручной запуск чек-ина самочувствия.",
    "/project_new — создать проект (wizard).",
    "/project_view <nameOrId> — карточка проекта и заметки.",
    "/project_list — список проектов.",
    "/project_update <nameOrId> key=value ... — быстрый апдейт.",
    "/project_focus <nameOrId> — установить фокус недели.",
    "/project_review <nameOrId> — weekly review проекта (wizard).",
    "/project_note — выбрать проект кнопкой и добавить заметку.",
    "/project_help — шпаргалка по project-командам.",
    "/task_project <taskIdOrTitle> <projectNameOrId> — связать задачу с проектом.",
    "/task_done — выбрать задачу кнопкой и закрыть ее в TickTick.",
    "",
    "Рекомендованный порядок: /tasks -> /plan -> /apply_categories -> /review",
  ].join("\n");

  await safeReply(ctx, text);
};
