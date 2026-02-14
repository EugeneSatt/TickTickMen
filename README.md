# TickTick Telegram Bot

## Projects

Новые команды управления проектами:

- `/project_new` — создание проекта через wizard
- `/project_view <nameOrId>` — карточка проекта + последние заметки
- `/project_list` — список проектов
- `/project_edit <nameOrId>` — редактирование проекта через wizard
- `/project_update <nameOrId> key=value ...` — быстрый патч полей
- `/project_focus <nameOrId>` — выставить фокус недели
- `/project_review <nameOrId>` — недельный review wizard
- `/project_note <nameOrId>` — добавить заметку
- `/project_help` — шпаргалка команд
- `/task_project <taskIdOrTitle> <projectNameOrId>` — привязать задачу к проекту

Пример:

```bash
/project_update RaffleAI status=PRE_LAUNCH horizonMonths=6 revenueGoal=300000 riskLevel=4 energyScore=5
```

## Setup

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```
