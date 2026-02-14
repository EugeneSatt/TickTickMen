import type { BotContext } from "../types/bot-context.types";
import { safeReply } from "../utils/telegram";

export const projectHelpCommand = async (ctx: BotContext): Promise<void> => {
  const text = [
    "🗂️ Project knowledge management",
    "",
    "/project_new — создать проект (wizard)",
    "/project_view <nameOrId> — карточка проекта + последние заметки",
    "/project_list — список проектов",
    "/project_update <nameOrId> key=value ... — быстрый патч",
    "/project_focus <nameOrId> — сделать проект фокусом недели",
    "/project_review <nameOrId> — недельный review (wizard)",
    "/project_note — выбрать проект кнопкой и добавить заметку",
    "/task_project <taskIdOrTitle> <projectNameOrId> — привязать задачу к проекту",
    "",
    "Пример:",
    "/project_update Neonika status=PRE_LAUNCH horizonMonths=6 revenueGoal=300000 riskLevel=4 energyScore=5",
  ].join("\n");

  await safeReply(ctx, text);
};
