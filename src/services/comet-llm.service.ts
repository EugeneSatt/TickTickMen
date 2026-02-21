import axios from "axios";
import { LLM_PROMPTS, SYSTEM_PROMPTS } from "../config/llm-prompts";
import type {
  PlanInput,
  PlanOutput,
  ReviewOutput,
  WeeklyReviewInput,
  WeeklyReviewOutput,
} from "../types/llm.types";
import { REASON_CODES } from "../types/domain.types";

const COMET_API_URL = "https://api.cometapi.com/v1/chat/completions";

const getNonEmptyEnv = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getCometModel = (): string =>
  getNonEmptyEnv(process.env.COMET_MODEL) ??
  getNonEmptyEnv(process.env.COMETAPI_MODEL) ??
  "gemini-2.5-pro";

const FALLBACK_MODELS = ["gemini-2.5-flash"];

const isDeploymentNotFoundError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const message = JSON.stringify(error.response?.data ?? {});
  return message.includes("DeploymentNotFound");
};

interface CometResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const extractJson = (text: string): string => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response does not contain JSON object");
  }
  return text.slice(start, end + 1);
};

const postComet = async (system: string, user: string): Promise<string> => {
  const apiKey = process.env.COMET_API_KEY ?? process.env.COMETAPI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing COMET_API_KEY/COMETAPI_API_KEY");
  }
  const modelsToTry = [getCometModel(), ...FALLBACK_MODELS.filter((m) => m !== getCometModel())];

  let lastError: unknown = null;
  let response: { data: CometResponse } | null = null;

  for (const model of modelsToTry) {
    try {
      response = await axios.post<CometResponse>(
        COMET_API_URL,
        {
          model,
          messages: [
            { role: SYSTEM_PROMPTS.role, content: system },
            { role: "user", content: user },
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
      if (model !== modelsToTry[0]) {
        console.log(`[Comet] fallback model used: ${model}`);
      }
      break;
    } catch (error: unknown) {
      lastError = error;
      if (isDeploymentNotFoundError(error) && model !== modelsToTry[modelsToTry.length - 1]) {
        console.warn(`[Comet] model unavailable, trying fallback: ${model}`);
        continue;
      }
      if (axios.isAxiosError(error)) {
        const details = typeof error.response?.data === "string"
          ? error.response?.data
          : JSON.stringify(error.response?.data ?? {});
        throw new Error(
          `Comet API request failed (${error.response?.status ?? "NO_STATUS"}): ${details}`
        );
      }
      throw error;
    }
  }

  if (!response) {
    if (axios.isAxiosError(lastError)) {
      const details = typeof lastError.response?.data === "string"
        ? lastError.response?.data
        : JSON.stringify(lastError.response?.data ?? {});
      throw new Error(
        `Comet API request failed (${lastError.response?.status ?? "NO_STATUS"}): ${details}`
      );
    }
    throw lastError ?? new Error("Comet API request failed");
  }

  const content = response.data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Empty LLM response");
  }

  return content;
};

export const generatePlan = async (input: PlanInput): Promise<PlanOutput> => {
  const systemPrompt = `${SYSTEM_PROMPTS.strategicAssistantRu}\n\n${LLM_PROMPTS.planJson}`;

  const content = await postComet(systemPrompt, JSON.stringify(input));
  const parsed = JSON.parse(extractJson(content)) as Partial<PlanOutput>;

  const focus = Array.isArray(parsed.focus)
    ? parsed.focus
        .map((item) => ({
          taskId: typeof item?.taskId === "string" ? item.taskId : "",
          reason: typeof item?.reason === "string" ? item.reason : "",
        }))
        .filter((item): item is PlanOutput["focus"][number] => !!item.taskId)
    : [];

  const fallbackOptions = Array.isArray(parsed.fallbackOptions)
    ? parsed.fallbackOptions
        .map((item) => ({
          forTaskId: typeof item?.forTaskId === "string" ? item.forTaskId : "",
          alternativeAction:
            typeof item?.alternativeAction === "string" ? item.alternativeAction : "",
          reason: typeof item?.reason === "string" ? item.reason : "",
        }))
        .filter(
          (item): item is PlanOutput["fallbackOptions"][number] =>
            !!item.forTaskId && !!item.alternativeAction
        )
    : [];

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((v): v is string => typeof v === "string")
    : [];
  const categorySuggestions = Array.isArray(parsed.categorySuggestions)
    ? parsed.categorySuggestions
        .map((item) => {
          const raw = item as {
            taskId?: unknown;
            suggestedCategory?: unknown;
            category?: unknown;
            confidence?: unknown;
            reason?: unknown;
          };
          return {
            taskId: typeof raw.taskId === "string" ? raw.taskId : "",
            category: raw.suggestedCategory ?? raw.category,
            confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
            reason: typeof raw.reason === "string" ? raw.reason : "",
          };
        })
        .filter(
          (item): item is PlanOutput["categorySuggestions"][number] =>
            !!item.taskId &&
            ["GROWTH", "MONEY", "SYSTEM", "LIFE"].includes(item.category as string) &&
            item.confidence >= 0 &&
            item.confidence <= 1
        )
    : [];

  return {
    focus,
    fallbackOptions,
    doNotDo: typeof parsed.doNotDo === "string" ? parsed.doNotDo : "",
    riskOfTheDay: typeof parsed.riskOfTheDay === "string" ? parsed.riskOfTheDay : "",
    warnings,
    strategyNote: typeof parsed.strategyNote === "string" ? parsed.strategyNote : "",
    categorySuggestions,
  };
};

export const generateReview = async (input: {
  day: string;
  done: string[];
  failed: string[];
  notes: string;
}): Promise<ReviewOutput> => {
  const systemPrompt = LLM_PROMPTS.reviewJson;
  const content = await postComet(systemPrompt, JSON.stringify(input));
  const parsed = JSON.parse(extractJson(content)) as Partial<ReviewOutput>;

  const likelyReasonCode =
    typeof parsed.likelyReasonCode === "string" &&
    REASON_CODES.includes(parsed.likelyReasonCode as (typeof REASON_CODES)[number])
      ? parsed.likelyReasonCode
      : "OTHER";

  return {
    whatWorked: Array.isArray(parsed.whatWorked)
      ? parsed.whatWorked.filter((v): v is string => typeof v === "string")
      : [],
    whatFailed: Array.isArray(parsed.whatFailed)
      ? parsed.whatFailed.filter((v): v is string => typeof v === "string")
      : [],
    likelyReasonCode,
    tomorrowAdjustment:
      typeof parsed.tomorrowAdjustment === "string" ? parsed.tomorrowAdjustment : "",
    microStep: typeof parsed.microStep === "string" ? parsed.microStep : "",
  };
};

export const generateWeeklyReviewAnalysis = async (
  input: WeeklyReviewInput
): Promise<WeeklyReviewOutput> => {
  const systemPrompt = `${SYSTEM_PROMPTS.strategicAssistantRu}\n\n${LLM_PROMPTS.reviewWeeklyJson}`;

  const userPayload = [
    "=== ПЕРИОД АНАЛИЗА ===",
    input.periodDescription,
    "",
    "=== СВОДНАЯ СТАТИСТИКА ЗА ПЕРИОД ===",
    JSON.stringify(input.weeklyFeatures),
    "",
    "=== СРЕДНИЙ ЭМОЦИОНАЛЬНЫЙ ФОН ===",
    JSON.stringify(input.weeklyEmotion),
    "",
    "=== СТАТИСТИКА ПО КАТЕГОРИЯМ ===",
    JSON.stringify(input.categoryDistribution),
    "",
    "=== AGE СТАТИСТИКА ===",
    JSON.stringify(input.weeklyAgeStats),
    "",
    "=== АКТИВНЫЕ ПРОЕКТЫ ===",
    JSON.stringify(input.projectsSnapshot),
    "",
    "=== ФОКУС ПРОЕКТ НЕДЕЛИ ===",
    JSON.stringify(input.focusProject),
  ].join("\n");

  const content = await postComet(systemPrompt, userPayload);
  const parsed = JSON.parse(extractJson(content)) as Partial<WeeklyReviewOutput>;

  return {
    mainPattern: typeof parsed.mainPattern === "string" ? parsed.mainPattern : "",
    systemOverload: Boolean(parsed.systemOverload),
    growthDeficit: Boolean(parsed.growthDeficit),
    avoidanceDetected: Boolean(parsed.avoidanceDetected),
    energyTrend: typeof parsed.energyTrend === "string" ? parsed.energyTrend : "нестабильно",
    focusProjectProgress:
      typeof parsed.focusProjectProgress === "string" ? parsed.focusProjectProgress : "отсутствует",
    strategicProblem: typeof parsed.strategicProblem === "string" ? parsed.strategicProblem : "",
    nextWeekAdjustments: Array.isArray(parsed.nextWeekAdjustments)
      ? parsed.nextWeekAdjustments.filter((v): v is string => typeof v === "string").slice(0, 3)
      : [],
    projectsToPause: Array.isArray(parsed.projectsToPause)
      ? parsed.projectsToPause.filter((v): v is string => typeof v === "string")
      : [],
    warning: typeof parsed.warning === "string" ? parsed.warning : "",
  };
};

export const generateTextSummary = async (
  period: "DAILY" | "WEEKLY",
  payload: Record<string, unknown>
): Promise<string> => {
  const systemPrompt =
    period === "DAILY"
      ? LLM_PROMPTS.dailySummaryRu
      : LLM_PROMPTS.weeklySummaryRu;

  const content = await postComet(systemPrompt, JSON.stringify(payload));
  return content.trim();
};
