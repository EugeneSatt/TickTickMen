import crypto from "node:crypto";
import axios, { AxiosError } from "axios";
import type { TickTickTask } from "../types/task.types";

const TICKTICK_SYNC_BASE_URL =
  process.env.TICKTICK_SYNC_BASE_URL?.trim() ?? "https://api.ticktick.com/api/v2";
const TICKTICK_OPEN_BASE_URL =
  process.env.TICKTICK_OPEN_BASE_URL?.trim() ?? "https://api.ticktick.com/open/v1";
const TICKTICK_SYNC_SIGNON_URL = `${TICKTICK_SYNC_BASE_URL}/user/signon?wc=true&remember=true`;
const TICKTICK_SYNC_BATCH_URL = `${TICKTICK_SYNC_BASE_URL}/batch/check/0`;
const TICKTICK_SYNC_COMPLETE_TASK_URL = (projectId: string, taskId: string) =>
  `${TICKTICK_SYNC_BASE_URL}/project/${projectId}/task/${taskId}/complete`;
const TICKTICK_OPEN_COMPLETE_TASK_URL = (projectId: string, taskId: string) =>
  `${TICKTICK_OPEN_BASE_URL}/project/${projectId}/task/${taskId}/complete`;
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

const DEFAULT_SYNC_USER_AGENT =
  process.env.TICKTICK_SYNC_USER_AGENT?.trim() ?? "Mozilla/5.0 (rv:145.0) Firefox/145.0";
const DEFAULT_SYNC_X_DEVICE = JSON.stringify({
  platform: "web",
  version: 6430,
  id: crypto.randomBytes(12).toString("hex"),
});

const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNABORTED"]);

interface SyncSignOnResponse {
  token?: string;
  inboxId?: string;
}

interface SyncProjectProfile {
  id?: string;
  name?: string;
  closed?: boolean;
}

interface SyncTask {
  id?: string;
  title?: string;
  projectId?: string;
  createdTime?: string;
  dueDate?: string;
  priority?: number;
  status?: number;
}

interface SyncBatchResponse {
  inboxId?: string;
  projectProfiles?: SyncProjectProfile[];
  syncTaskBean?: {
    update?: SyncTask[];
  };
}

let cachedSyncToken: string | null = null;
let cachedSyncTokenExpiresAt = 0;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const logAxiosError = (prefix: string, error: AxiosError): void => {
  console.error(`${prefix}: ${error.response?.status ?? "NO_STATUS"} ${error.message}`);
  if (error.response?.data) {
    console.error(`${prefix} payload:`, error.response.data);
  }
};

const shouldRetryNetworkError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const code = (error as AxiosError).code;
  return Boolean(code && RETRYABLE_NETWORK_CODES.has(code));
};

const withNetworkRetry = async <T>(
  operationName: string,
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < maxAttempts && shouldRetryNetworkError(error)) {
        console.error(`[TickTick] ${operationName} network retry ${attempt}/${maxAttempts}`);
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
};

export const getTickTickAuthSetupHint = (): string | null => {
  const hasStaticSyncToken = Boolean(process.env.TICKTICK_SYNC_TOKEN?.trim());
  const hasSyncUsername = Boolean(process.env.TICKTICK_SYNC_USERNAME?.trim());
  const hasSyncPassword = Boolean(process.env.TICKTICK_SYNC_PASSWORD?.trim());

  if (hasStaticSyncToken || (hasSyncUsername && hasSyncPassword)) {
    return null;
  }

  return "TickTick Sync API is not configured. Set TICKTICK_SYNC_USERNAME and TICKTICK_SYNC_PASSWORD (recommended), or set TICKTICK_SYNC_TOKEN.";
};

const getSyncHeaders = (): Record<string, string> => ({
  "User-Agent": DEFAULT_SYNC_USER_AGENT,
  "X-Device": process.env.TICKTICK_SYNC_X_DEVICE?.trim() ?? DEFAULT_SYNC_X_DEVICE,
  "Content-Type": "application/json",
});

const getSyncToken = async (): Promise<string | null> => {
  const now = Date.now();
  if (cachedSyncToken && now < cachedSyncTokenExpiresAt - TOKEN_EXPIRY_SAFETY_MS) {
    return cachedSyncToken;
  }

  const staticToken = process.env.TICKTICK_SYNC_TOKEN?.trim();
  if (staticToken) {
    cachedSyncToken = staticToken;
    cachedSyncTokenExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
    return staticToken;
  }

  const username = process.env.TICKTICK_SYNC_USERNAME?.trim();
  const password = process.env.TICKTICK_SYNC_PASSWORD?.trim();

  if (!username || !password) {
    console.error(
      "[TickTick] Missing Sync API env vars: TICKTICK_SYNC_USERNAME and/or TICKTICK_SYNC_PASSWORD"
    );
    return null;
  }

  try {
    console.log("[TickTick] Sync API sign-on...");

    const response = await withNetworkRetry("sync sign-on", () =>
      axios.post<SyncSignOnResponse>(
        TICKTICK_SYNC_SIGNON_URL,
        {
          username,
          password,
        },
        {
          headers: getSyncHeaders(),
          timeout: 15000,
        }
      )
    );

    const token = response.data.token?.trim();
    if (!token) {
      console.error("[TickTick] Sync sign-on response did not contain token");
      return null;
    }

    cachedSyncToken = token;
    cachedSyncTokenExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
    return token;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      logAxiosError("[TickTick] Sync sign-on error", error as AxiosError);
    } else {
      console.error("[TickTick] Unknown sync sign-on error", error);
    }
    return null;
  }
};

const buildProjectNameMap = (batchData: SyncBatchResponse): Map<string, string> => {
  const map = new Map<string, string>();

  const profiles = Array.isArray(batchData.projectProfiles) ? batchData.projectProfiles : [];
  for (const profile of profiles) {
    if (!profile.id || profile.closed) {
      continue;
    }
    map.set(profile.id, profile.name?.trim() || "Untitled");
  }

  if (batchData.inboxId) {
    map.set(batchData.inboxId, "Входящие");
  }

  return map;
};

const normalizeTask = (task: SyncTask, projectNameById: Map<string, string>): TickTickTask | null => {
  if (!task.id || !task.title) {
    return null;
  }

  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: task.projectId ? projectNameById.get(task.projectId) : undefined,
    createdDate: task.createdTime,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
  };
};

export const getActiveTasks = async (): Promise<TickTickTask[]> => {
  const syncToken = await getSyncToken();
  if (!syncToken) {
    console.error("[TickTick] Cannot fetch tasks without Sync API token");
    return [];
  }

  try {
    console.log("[TickTick] Fetching tasks from Sync API /batch/check/0 ...");

    const batchResponse = await withNetworkRetry("fetch sync batch", () =>
      axios.get<SyncBatchResponse>(TICKTICK_SYNC_BATCH_URL, {
        headers: {
          ...getSyncHeaders(),
          Cookie: `t=${syncToken}`,
        },
        timeout: 20000,
      })
    );

    const batchData = batchResponse.data;
    const projectNameById = buildProjectNameMap(batchData);
    const rawTasks = Array.isArray(batchData.syncTaskBean?.update) ? batchData.syncTaskBean?.update : [];

    const tasks = rawTasks
      .map((task) => normalizeTask(task, projectNameById))
      .filter((task): task is TickTickTask => task !== null)
      .filter((task) => task.status !== 2);

    console.log(`[TickTick] Loaded ${tasks.length} active tasks from Sync API`);
    return tasks;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      logAxiosError("[TickTick] Sync batch error", error as AxiosError);
    } else {
      console.error("[TickTick] Unknown sync batch error", error);
    }

    return [];
  }
};

export const completeTask = async (params: {
  projectId: string;
  taskId: string;
}): Promise<{ ok: boolean; message?: string }> => {
  const errorMessages: string[] = [];

  const oauthAccessToken = process.env.TICKTICK_ACCESS_TOKEN?.trim();
  if (oauthAccessToken) {
    try {
      await withNetworkRetry("complete task open/v1", () =>
        axios.post(
          TICKTICK_OPEN_COMPLETE_TASK_URL(params.projectId, params.taskId),
          {},
          {
            headers: {
              Authorization: `Bearer ${oauthAccessToken}`,
              "Content-Type": "application/json",
            },
            timeout: 20000,
          }
        )
      );
      return { ok: true };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logAxiosError("[TickTick] Open API complete task error", error as AxiosError);
        errorMessages.push(
          `open/v1: ${error.response?.status ?? "NO_STATUS"} ${String(
            (error.response?.data as { errorMessage?: string } | undefined)?.errorMessage ?? error.message
          )}`
        );
      } else {
        console.error("[TickTick] Open API complete task unknown error", error);
        errorMessages.push("open/v1: unknown error");
      }
    }
  } else {
    errorMessages.push("open/v1: нет TICKTICK_ACCESS_TOKEN");
  }

  const syncToken = await getSyncToken();
  if (!syncToken) {
    errorMessages.push("sync/v2: нет sync token");
    return { ok: false, message: `TickTick не подтвердил закрытие (${errorMessages.join(" | ")})` };
  }

  try {
    await withNetworkRetry("complete task sync/v2", () =>
      axios.post(
        TICKTICK_SYNC_COMPLETE_TASK_URL(params.projectId, params.taskId),
        {},
        {
          headers: {
            ...getSyncHeaders(),
            Cookie: `t=${syncToken}`,
          },
          timeout: 20000,
        }
      )
    );
    return { ok: true };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      logAxiosError("[TickTick] Sync API complete task error", error as AxiosError);
      errorMessages.push(
        `sync/v2: ${error.response?.status ?? "NO_STATUS"} ${String(
          (error.response?.data as { errorMessage?: string } | undefined)?.errorMessage ?? error.message
        )}`
      );
    } else {
      console.error("[TickTick] Sync API complete task unknown error", error);
      errorMessages.push("sync/v2: unknown error");
    }
    return { ok: false, message: `TickTick не подтвердил закрытие (${errorMessages.join(" | ")})` };
  }
};
