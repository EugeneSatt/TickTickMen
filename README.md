# TickTick Telegram Bot

Телеграм-бот для личного планирования на базе TickTick, Prisma, grammY и CometAPI.

Бот умеет:
- синхронизировать задачи из TickTick в локальную БД;
- строить дневной план через LLM;
- хранить историю закрытых задач и анализировать поведенческие паттерны;
- вести чек-ины настроения, энергии и фокуса;
- работать с проектами и заметками по проектам;
- отправлять talk/news/pomodoro-напоминания по cron.

## Основные сценарии

### 1. Задачи и планирование
- `/tasks` — синхронизирует задачи из TickTick и показывает их по папкам.
- `/plan` — строит план на день через LLM.
- `/agent_mode` — переключает режим агента через кнопки.
- `/apply_categories` — применяет предложенные LLM категории к задачам.
- `/task_done` — закрывает задачу в TickTick из Telegram.
- `/task_project <taskIdOrTitle> <projectNameOrId>` — связывает задачу с проектом в локальной БД.

### 2. Самочувствие и daily workflow
- `/mood` — ручной запуск чек-ина.
- Утром после заполнения чек-ина бот сразу пытается построить автоплан.
- `/review` — weekly review за последние 7 дней от текущего момента.
- `/summary_daily` — короткая дневная сводка.
- `/summary_weekly` — недельная сводка.

### 3. Проекты
- `/project_new` — создание проекта через wizard.
- `/project_view <nameOrId>` — карточка проекта и последние заметки.
- `/project_list` — список проектов.
- `/project_update` — обновление проекта через кнопки и сообщения.
- `/project_focus` — выбор фокусного проекта кнопками.
- `/project_review` — review проекта через wizard.
- `/project_note` — выбрать проект и добавить заметку.
- `/project_help` — шпаргалка.

### 4. Talk и новостные потоки
- `/talk` — ищет задачи с маркерами `talk/толк`, делает сводку по теме и отправляет через второго бота.
- Отдельный daily news digest уходит через второго бота в случайное время.

## Как устроен проект

### Технологии
- `Node.js`
- `TypeScript`
- `grammy`
- `axios`
- `Prisma + PostgreSQL`
- `Luxon`
- `CometAPI`

### Главные директории
- `src/bot.ts` — основной Telegram bot entrypoint.
- `src/commands/` — команды и callback-handlers.
- `src/services/` — бизнес-логика, TickTick sync, LLM, planning, emotion, cron use cases.
- `src/jobs/` — cron entrypoint для Railway.
- `src/db/prisma.ts` — Prisma client.
- `prisma/schema.prisma` — схема БД.

## Поведенческая память

Бот не "дообучает" модель в ML-смысле. Вместо этого он хранит историю планов и фактических закрытий задач и использует ее как персональную память.

Что сохраняется:
- открытые и закрытые задачи TickTick;
- `completedAt` и `TaskEvent` для закрытий;
- агрегаты по дням в `DailyFeatures`;
- дневные снапшоты плана в `UserRule`;
- статистика follow-through: что было предложено и что реально закрыто;
- задачи, которые пользователь закрывает вне плана;
- категории и проекты, куда пользователь уходит чаще всего.

Что это дает LLM:
- план строится не только по "идеальному" сценарию;
- если пользователь обычно закрывает другие задачи, это учитывается;
- можно выявлять SYSTEM-перекосы, избегание и реальные рабочие паттерны.

## Режимы агента

Через `/agent_mode` можно переключать режим, в котором LLM интерпретирует задачи и приоритеты.

Доступные режимы:
- `FOUNDATION` — устойчивость, здоровье, порядок, система жизни, накопление капитала.
- `PRE_STARTUP` — переходный этап: база сохраняется, но уже есть умеренный фокус на запуск.
- `STARTUP` — предпринимательский режим с большим весом у `MONEY`, `GROWTH`, запуска и рынка.

Режим хранится в `UserRule` и участвует в:
- дневном плане `/plan`;
- weekly review;
- интерпретации того, когда `SYSTEM/LIFE` задачи стратегически оправданы, а когда уже становятся избеганием.

## TickTick: источник правды

Бот использует локальную БД как оперативный кеш и аналитическое хранилище.

Источник правды по задачам:
- активные задачи берутся из TickTick Sync API;
- закрытия, сделанные через `/task_done`, сразу отражаются в TickTick и БД;
- закрытия, сделанные вручную в самом TickTick, попадают в БД при следующем sync;
- ночной sync в 02:00 МСК помечает исчезнувшие из активного списка задачи как `DONE`;
- удаленные в TickTick пустые авто-созданные проекты очищаются из БД во время sync.

## Расписание cron

`npm run cron` должен запускаться регулярно, оптимально раз в 5 минут.

Текущее расписание внутри job:
- `08:30` МСК — утренний mood check-in.
- `22:00` МСК — вечерний mood check-in.
- `10:00-17:00` МСК — 3 случайных pomodoro-пинга в день.
- `08:00-23:00` МСК — 4-5 случайных news digest-сообщений в день через второго бота.
- `18:00+` МСК — один auto-talk digest в день через второго бота.
- `00:05` МСК — пересчет `DailyFeatures`.
- `02:00` МСК — ночной sync задач из TickTick.
- `понедельник 11:00` МСК — weekly review за прошлую календарную неделю.

Для Railway:
- web/service command: `npm run start`
- cron command: `npm run cron`
- рекомендуемый cron schedule: `*/5 * * * *`

## Переменные окружения

Смотри `.env.example`.

### Обязательные
- `BOT_TOKEN` — основной Telegram-бот.
- `DATABASE_URL` — PostgreSQL.
- `TICKTICK_SYNC_TOKEN` или пара `TICKTICK_SYNC_USERNAME` / `TICKTICK_SYNC_PASSWORD`.
- `COMET_API_KEY` или `COMETAPI_API_KEY`.

### Второй бот и логи
- `BOT_TOKEN_TALK` — второй бот для `/talk` и news digest.
- `LOGS_BOT_TOKEN` — бот для отправки LLM prompt logs.
- `LOGS_CHAT_ID` — chat id для логов.

### Ограничение доступа
- `ALLOWED_TG_USER_ID` — один разрешенный Telegram user id.

### TickTick Sync API
- `TICKTICK_SYNC_BASE_URL`
- `TICKTICK_SYNC_USER_AGENT`
- `TICKTICK_SYNC_X_DEVICE`

### LLM
- `COMET_MODEL`
- `COMETAPI_MODEL`
- `COMET_TIMEOUT_MS`
- `TALK_MODEL`

### Cron
- `ENABLE_CRON`
- `CRON_WINDOW_MINUTES`
- `APP_TIMEZONE`

## Локальный запуск

### 1. Установка
```bash
npm install
npm run prisma:generate
```

### 2. Миграции
```bash
npm run prisma:migrate
```

### 3. Режим разработки
```bash
npm run dev
```

### 4. Сборка и прод-запуск
```bash
npm run build
npm run start
```

### 5. Локальный cron
```bash
npm run cron
```

## Команды бота

### Базовые
- `/start` — список команд.
- `/tasks` — sync + показ задач.
- `/plan` — план на день.
- `/agent_mode` — выбор режима агента кнопками.
- `/apply_categories` — применить предложенные категории.
- `/review` — review за последние 7 дней.
- `/summary_daily`
- `/summary_weekly`

### Mood
- `/mood` — выбрать утро/вечер, затем пройти чек-ин текстом или голосом.

### Проекты
- `/project_new`
- `/project_view <nameOrId>`
- `/project_list`
- `/project_update`
- `/project_focus`
- `/project_review`
- `/project_note`
- `/project_help`

### Задачи
- `/task_project <taskIdOrTitle> <projectNameOrId>`
- `/task_done`

### Talk
- `/talk` — обработка задач с маркерами `talk/толк`.

## Важные детали реализации

### 1. Long polling
Проект работает через long polling. При старте бот очищает webhook и запускает polling.

### 2. Один пользователь
Сейчас бот рассчитан на персональное использование. Все команды режутся middleware по `ALLOWED_TG_USER_ID`.

### 3. News digest
News digest генерируется не основным ботом, а ботом из `BOT_TOKEN_TALK`.

### 4. Prompt logs
Все важные LLM prompt logs могут дублироваться в Telegram через `LOGS_BOT_TOKEN`.

### 5. План строится по локальной БД
Перед `/plan` делается принудительный sync из TickTick. Если sync не удался, план строится по последним данным из БД.

## Полезные файлы
- `src/bot.ts`
- `src/jobs/cron.ts`
- `src/jobs/sendDailyNotifications.ts`
- `src/services/ticktick.service.ts`
- `src/services/task-sync.service.ts`
- `src/services/planning.service.ts`
- `src/services/emotion.service.ts`
- `src/services/talk.service.ts`
- `src/services/news-digest.service.ts`
- `src/config/llm-prompts.ts`
- `prisma/schema.prisma`
