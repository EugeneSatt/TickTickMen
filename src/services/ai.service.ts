import axios, { AxiosError } from "axios";
import { LLM_PROMPTS, SYSTEM_PROMPTS } from "../config/llm-prompts";

const COMET_API_URL = "https://api.cometapi.com/v1/chat/completions";

interface CometMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CometCompletionRequest {
  model: string;
  messages: CometMessage[];
}

interface CometCompletionChoice {
  message?: {
    content?: string;
  };
}

interface CometCompletionResponse {
  choices?: CometCompletionChoice[];
}

export const summarizeTasks = async (tasksText: string): Promise<string> => {
  const apiKey = process.env.COMET_API_KEY;

  if (!apiKey) {
    console.error("[CometAPI] Missing COMET_API_KEY environment variable");
    return "AI summary unavailable (missing COMET_API_KEY).";
  }

  const payload: CometCompletionRequest = {
    model: "gpt-5.2",
    messages: [
      {
        role: SYSTEM_PROMPTS.role,
        content: LLM_PROMPTS.tasksSummary,
      },
      {
        role: "user",
        content: tasksText,
      },
    ],
  };

  try {
    console.log("[CometAPI] Requesting AI summary...");

    const response = await axios.post<CometCompletionResponse>(COMET_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const summary = response.data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      console.error("[CometAPI] Empty summary response");
      return "AI summary unavailable right now.";
    }

    return summary;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error(
        `[CometAPI] API error: ${axiosError.response?.status ?? "NO_STATUS"} ${axiosError.message}`
      );
    } else {
      console.error("[CometAPI] Unknown error while generating summary", error);
    }

    return "AI summary unavailable right now.";
  }
};
