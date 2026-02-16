import axios from "axios";
import { Prisma, TaskSource, TaskStatus } from "@prisma/client";
import type { Bot } from "grammy";
import { LLM_PROMPTS } from "../config/llm-prompts";
import { prisma } from "../db/prisma";
import { completeTask, getActiveTasks } from "./ticktick.service";

const COMET_API_URL = "https://api.cometapi.com/v1/chat/completions";
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const TALK_AUTO_SENT_RULE_PREFIX = "talk_auto_sent:";
const DEFAULT_TALK_MODEL = "gemini-2.5-flash";
const TALK_SUMMARY_LIMIT = 900;
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TALK_NEWS_LIMIT = 5;

const TALK_PHRASE_MARKERS = ["/talk", "/толк", "slash talk", "слеш толк"];
const TALK_WORD_PATTERN = /(^|[^\p{L}\p{N}_])(talk|толк)(?=$|[^\p{L}\p{N}_])/iu;

interface CometResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface TalkTask {
  id: string;
  source: TaskSource;
  externalId: string | null;
  projectId: string | null;
  title: string;
  note: string | null;
  projectName: string | null;
  dueAt: Date | null;
}

interface TalkTopicBucket {
  topic: string;
  tasks: TalkTask[];
}

interface NewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface TalkTopicSummary {
  topic: string;
  summary: string;
  news: NewsArticle[];
  taskRefs: Array<{
    id: string;
    source: TaskSource;
    externalId: string | null;
    projectId: string | null;
    title: string;
  }>;
  tasks: Array<{
    title: string;
    projectName: string | null;
    dueAt: Date | null;
  }>;
}

export interface TalkCloseResult {
  attempted: number;
  closed: number;
  failed: number;
  skipped: number;
}

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

const truncate = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

const stripCdata = (value: string): string => value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/");

const extractXmlTag = (block: string, tag: string): string | null => {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(regex);
  if (!match?.[1]) {
    return null;
  }
  return decodeXmlEntities(stripCdata(match[1]).trim());
};

const parseGoogleNewsRss = (xml: string): NewsArticle[] => {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const items: NewsArticle[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < TALK_NEWS_LIMIT) {
    const block = match[1];
    const title = extractXmlTag(block, "title");
    const url = extractXmlTag(block, "link");
    if (!title || !url) {
      continue;
    }

    const source = extractXmlTag(block, "source") ?? "Источник";
    const publishedAt = extractXmlTag(block, "pubDate");
    items.push({
      title: truncate(normalizeWhitespace(title), 180),
      url: url.trim(),
      source: normalizeWhitespace(source),
      publishedAt: publishedAt ? normalizeWhitespace(publishedAt) : null,
    });
  }

  return items;
};

const fetchLatestNewsByTopic = async (topic: string): Promise<NewsArticle[]> => {
  try {
    const response = await axios.get<string>(GOOGLE_NEWS_RSS_URL, {
      params: {
        q: topic,
        hl: "ru",
        gl: "RU",
        ceid: "RU:ru",
      },
      responseType: "text",
      timeout: 15000,
    });

    const articles = parseGoogleNewsRss(response.data);
    if (!articles.length) {
      console.warn("[Talk] No news parsed from RSS", { topic });
    }
    return articles;
  } catch (error: unknown) {
    console.error("[Talk] Failed to fetch latest news", { topic, error });
    return [];
  }
};

const containsTalkMarker = (text: string): boolean => {
  const lower = text.toLowerCase();
  if (TALK_PHRASE_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }
  return TALK_WORD_PATTERN.test(text);
};

const findEarliestPhraseMarker = (text: string): { index: number; marker: string } | null => {
  const lower = text.toLowerCase();
  let earliest: { index: number; marker: string } | null = null;

  for (const marker of TALK_PHRASE_MARKERS) {
    const index = lower.indexOf(marker);
    if (index === -1) {
      continue;
    }
    if (!earliest || index < earliest.index) {
      earliest = { index, marker };
    }
  }

  return earliest;
};

const extractTopicFromTask = (task: TalkTask): string => {
  const source = normalizeWhitespace(task.title || "");
  const phraseMarker = findEarliestPhraseMarker(source);

  let markerIndex = -1;
  let markerLength = 0;
  if (phraseMarker) {
    markerIndex = phraseMarker.index;
    markerLength = phraseMarker.marker.length;
  }

  const wordMatch = TALK_WORD_PATTERN.exec(source);
  if (wordMatch) {
    const leading = wordMatch[1] ?? "";
    const word = wordMatch[2] ?? "";
    const wordIndex = wordMatch.index + leading.length;
    if (markerIndex === -1 || wordIndex < markerIndex) {
      markerIndex = wordIndex;
      markerLength = word.length;
    }
  }

  if (markerIndex >= 0) {
    const afterMarker = normalizeWhitespace(
      source
        .slice(markerIndex + markerLength)
        .replace(/^[\s:;|,.\-—–/]+/u, "")
    );
    if (afterMarker) {
      return truncate(afterMarker, 160);
    }
  }

  const withoutPhrases = TALK_PHRASE_MARKERS.reduce(
    (acc, marker) => acc.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " "),
    source
  );
  const withoutWordMarker = withoutPhrases.replace(TALK_WORD_PATTERN, (_match, prefix: string) => `${prefix} `);
  const normalized = normalizeWhitespace(withoutWordMarker.replace(/^[\s:;|,.\-—–/]+/u, ""));
  if (normalized) {
    return truncate(normalized, 160);
  }

  return "Без названия темы";
};

const groupTalkTasksByTopic = (tasks: TalkTask[]): TalkTopicBucket[] => {
  const byTopic = new Map<string, TalkTopicBucket>();

  for (const task of tasks) {
    const topic = extractTopicFromTask(task);
    const normalizedTopic = topic.toLocaleLowerCase("ru-RU");
    const existing = byTopic.get(normalizedTopic);
    if (!existing) {
      byTopic.set(normalizedTopic, {
        topic,
        tasks: [task],
      });
      continue;
    }
    existing.tasks.push(task);
  }

  return Array.from(byTopic.values()).sort((a, b) => b.tasks.length - a.tasks.length);
};

const getTalkModel = (): string => {
  const explicit = process.env.TALK_MODEL?.trim();
  if (explicit) {
    return explicit;
  }
  return DEFAULT_TALK_MODEL;
};

const getCometKey = (): string | null => {
  const key = process.env.COMET_API_KEY ?? process.env.COMETAPI_API_KEY;
  return key?.trim() || null;
};

const buildFallbackSummary = (topic: string, tasks: TalkTask[], news: NewsArticle[]): string => {
  if (news.length > 0) {
    const top = news.slice(0, 2).map((item) => item.title).join("; ");
    return truncate(
      `По теме "${topic}" найдены свежие новости (${news.length}): ${top}. Проверь источники ниже.`,
      TALK_SUMMARY_LIMIT
    );
  }

  const sample = tasks.slice(0, 3).map((task) => task.title).join("; ");
  return truncate(
    `По теме "${topic}" не удалось получить свежие новости. Контекст из задач: ${sample || "без деталей"}.`,
    TALK_SUMMARY_LIMIT
  );
};

const summarizeTalkTopicWithLlm = async (
  topic: string,
  tasks: TalkTask[],
  news: NewsArticle[]
): Promise<string> => {
  if (!news.length) {
    return buildFallbackSummary(topic, tasks, news);
  }

  const apiKey = getCometKey();
  if (!apiKey) {
    console.error("[Talk] Missing COMET_API_KEY/COMETAPI_API_KEY. Using fallback summary.");
    return buildFallbackSummary(topic, tasks, news);
  }

  const model = getTalkModel();
  const inputTasks = tasks.slice(0, 5).map((task, index) => ({
    n: index + 1,
    title: task.title,
    project: task.projectName ?? "Без проекта",
    note: task.note ? truncate(normalizeWhitespace(task.note), 180) : null,
  }));
  const inputNews = news.map((item, index) => ({
    n: index + 1,
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    url: item.url,
  }));

  const systemPrompt = LLM_PROMPTS.talkNewsSummaryRu;
  const userPrompt = JSON.stringify({
    topic,
    newsCount: news.length,
    news: inputNews,
    relatedTasks: inputTasks,
    format: "3-5 коротких предложений: что произошло, почему важно, что мониторить дальше.",
  });

  try {
    const response = await axios.post<CometResponse>(
      COMET_API_URL,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const summary = response.data.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      console.error("[Talk] Empty LLM summary. Using fallback.", { topic, taskCount: tasks.length });
      return buildFallbackSummary(topic, tasks, news);
    }

    return truncate(summary, TALK_SUMMARY_LIMIT);
  } catch (error: unknown) {
    console.error("[Talk] Failed to summarize topic with LLM. Using fallback.", {
      topic,
      taskCount: tasks.length,
      error,
    });
    return buildFallbackSummary(topic, tasks, news);
  }
};

const loadTalkCandidateTasks = async (userId: string): Promise<TalkTask[]> => {
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: TaskStatus.OPEN,
    },
    select: {
      id: true,
      source: true,
      externalId: true,
      projectId: true,
      title: true,
      note: true,
      projectName: true,
      dueAt: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return tasks.filter((task) => containsTalkMarker(`${task.title}\n${task.note ?? ""}`));
};

export const buildTalkTopicSummariesForUser = async (userId: string): Promise<TalkTopicSummary[]> => {
  const candidates = await loadTalkCandidateTasks(userId);
  if (!candidates.length) {
    return [];
  }

  const grouped = groupTalkTasksByTopic(candidates);
  const summaries: TalkTopicSummary[] = [];
  for (const bucket of grouped) {
    const news = await fetchLatestNewsByTopic(bucket.topic);
    const summary = await summarizeTalkTopicWithLlm(bucket.topic, bucket.tasks, news);
    summaries.push({
      topic: bucket.topic,
      summary,
      news,
      taskRefs: bucket.tasks.map((task) => ({
        id: task.id,
        source: task.source,
        externalId: task.externalId,
        projectId: task.projectId,
        title: task.title,
      })),
      tasks: bucket.tasks.map((task) => ({
        title: task.title,
        projectName: task.projectName,
        dueAt: task.dueAt,
      })),
    });
  }

  return summaries;
};

export const formatTalkSummaryMessage = (
  item: TalkTopicSummary,
  index: number,
  total: number
): string => {
  const taskLines = item.tasks.slice(0, 5).map((task) => {
    const project = task.projectName ? ` (${task.projectName})` : "";
    return `- ${task.title}${project}`;
  });
  const moreLine = item.tasks.length > 5 ? [`- ...еще ${item.tasks.length - 5}`] : [];
  const sourceLines =
    item.news.length > 0
      ? item.news.map((article, articleIndex) => `${articleIndex + 1}. ${article.source}: ${article.url}`)
      : ["Нет свежих новостей по этой теме."];
  const body = [
    `Тема ${index + 1}/${total}: ${item.topic}`,
    "",
    item.summary,
    "",
    "Источники:",
    ...sourceLines,
    "",
    "Связанные задачи:",
    ...taskLines,
    ...moreLine,
  ].join("\n");

  return truncate(body, TELEGRAM_MESSAGE_LIMIT);
};

const uniqueClosableTaskRefs = (
  refs: TalkTopicSummary["taskRefs"]
): Array<{ externalId: string; title: string }> => {
  const seen = new Set<string>();
  const result: Array<{ externalId: string; title: string }> = [];

  for (const ref of refs) {
    if (ref.source !== TaskSource.TICKTICK || !ref.externalId) {
      continue;
    }
    const key = ref.externalId;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      externalId: ref.externalId,
      title: ref.title,
    });
  }

  return result;
};

const markTickTickTaskClosedInDb = async (userId: string, externalId: string): Promise<void> => {
  const now = new Date();
  const updated = await prisma.task.updateMany({
    where: {
      userId,
      source: TaskSource.TICKTICK,
      externalId,
      status: TaskStatus.OPEN,
    },
    data: {
      status: TaskStatus.DONE,
      completedAt: now,
      lastSeenAt: now,
    },
  });

  if (!updated.count) {
    return;
  }

  const tasksInDb = await prisma.task.findMany({
    where: {
      userId,
      source: TaskSource.TICKTICK,
      externalId,
    },
    select: { id: true },
  });

  if (!tasksInDb.length) {
    return;
  }

  await prisma.taskEvent.createMany({
    data: tasksInDb.map((task) => ({
      userId,
      taskId: task.id,
      type: "TALK_COMPLETE_AFTER_SUMMARY",
      at: now,
      fromStatus: TaskStatus.OPEN,
      toStatus: TaskStatus.DONE,
      meta: {
        source: "TALK",
      },
    })),
  });
};

export const closeTalkTopicTasksAfterSummary = async (
  userId: string,
  refs: TalkTopicSummary["taskRefs"]
): Promise<TalkCloseResult> => {
  const closable = uniqueClosableTaskRefs(refs);
  if (!closable.length) {
    return {
      attempted: 0,
      closed: 0,
      failed: 0,
      skipped: refs.length,
    };
  }

  let closed = 0;
  let failed = 0;
  const activeTasks = await getActiveTasks();
  const ticktickProjectByTaskId = new Map<string, string>();
  for (const task of activeTasks) {
    if (task.id && task.projectId) {
      ticktickProjectByTaskId.set(task.id, task.projectId);
    }
  }

  for (const task of closable) {
    const ticktickProjectId = ticktickProjectByTaskId.get(task.externalId);
    if (!ticktickProjectId) {
      failed += 1;
      console.error("[Talk] Failed to resolve TickTick projectId for task", {
        userId,
        taskId: task.externalId,
        title: task.title,
      });
      continue;
    }

    const result = await completeTask({
      projectId: ticktickProjectId,
      taskId: task.externalId,
    });

    if (!result.ok) {
      failed += 1;
      console.error("[Talk] Failed to close TickTick task after summary", {
        userId,
        taskId: task.externalId,
        projectId: ticktickProjectId,
        title: task.title,
        message: result.message ?? null,
      });
      continue;
    }

    await markTickTickTaskClosedInDb(userId, task.externalId);
    closed += 1;
  }

  return {
    attempted: closable.length,
    closed,
    failed,
    skipped: Math.max(0, refs.length - closable.length),
  };
};

const talkAutoSentRuleKey = (userId: string, dayKey: string): string =>
  `${TALK_AUTO_SENT_RULE_PREFIX}${userId}:${dayKey}`;

const markTalkAutoSent = async (params: {
  userId: string;
  dayKey: string;
  topicsCount: number;
}): Promise<void> => {
  const key = talkAutoSentRuleKey(params.userId, params.dayKey);
  await prisma.userRule.upsert({
    where: { key },
    update: {
      userId: params.userId,
      isActive: true,
      value: ({
        sentAt: new Date().toISOString(),
        topicsCount: params.topicsCount,
      } as unknown) as Prisma.InputJsonValue,
    },
    create: {
      key,
      userId: params.userId,
      isActive: true,
      value: ({
        sentAt: new Date().toISOString(),
        topicsCount: params.topicsCount,
      } as unknown) as Prisma.InputJsonValue,
    },
  });
};

export const sendAutoTalkSummariesToAllUsers = async (
  bot: Bot,
  dayKey: string
): Promise<{ sentUsers: number; skippedUsers: number; failedUsers: number }> => {
  const users = await prisma.user.findMany({
    select: { id: true, tgUserId: true },
  });

  let sentUsers = 0;
  let skippedUsers = 0;
  let failedUsers = 0;

  for (const user of users) {
    const key = talkAutoSentRuleKey(user.id, dayKey);
    const alreadySent = await prisma.userRule.findUnique({
      where: { key },
      select: { isActive: true },
    });
    if (alreadySent?.isActive) {
      skippedUsers += 1;
      continue;
    }

    try {
      const summaries = await buildTalkTopicSummariesForUser(user.id);
      if (!summaries.length) {
        await markTalkAutoSent({
          userId: user.id,
          dayKey,
          topicsCount: 0,
        });
        skippedUsers += 1;
        continue;
      }

      await bot.api.sendMessage(Number(user.tgUserId), "Talk-сводка по отмеченным темам:");
      for (let i = 0; i < summaries.length; i += 1) {
        const summary = summaries[i];
        await bot.api.sendMessage(Number(user.tgUserId), formatTalkSummaryMessage(summary, i, summaries.length));
        const closeResult = await closeTalkTopicTasksAfterSummary(user.id, summary.taskRefs);
        console.log("[Talk] Auto close after summary", {
          userId: user.id,
          topic: summary.topic,
          closeResult,
        });
      }

      await markTalkAutoSent({
        userId: user.id,
        dayKey,
        topicsCount: summaries.length,
      });
      sentUsers += 1;
    } catch (error: unknown) {
      failedUsers += 1;
      console.error("[Talk] Auto summary failed for user", {
        userId: user.id,
        error,
      });
    }
  }

  return { sentUsers, skippedUsers, failedUsers };
};
