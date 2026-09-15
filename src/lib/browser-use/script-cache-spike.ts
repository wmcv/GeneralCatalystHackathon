import "server-only";

import {
  BrowserUse,
  type MessageResponse,
  type SessionResult,
} from "browser-use-sdk/v3";
import { z } from "zod";
import { browserUseConfig, getBrowserUseEnv } from "./config";

const wikipediaResultSchema = z.object({
  title: z.string(),
  url: z.url(),
});

const queryValues = ["mechanical keyboard", "ergonomic keyboard"] as const;

function buildTask(query: string): string {
  return `Go to https://en.wikipedia.org and search for @{{${query}}}.
Return JSON only with the article title and final URL in this shape:
{"title":"string","url":"https://..."}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseOutput(output: unknown) {
  try {
    const value = typeof output === "string" ? JSON.parse(output) : output;
    const parsed = wikipediaResultSchema.safeParse(value);
    return parsed.success
      ? { parsedResult: parsed.data, validationError: null }
      : { parsedResult: null, validationError: parsed.error.message };
  } catch (error) {
    return { parsedResult: null, validationError: errorMessage(error) };
  }
}

function cacheEvidence(messages: MessageResponse[]): string[] {
  return messages
    .filter((message) => /cache|script/i.test(`${message.type} ${message.summary} ${message.data}`))
    .map((message) => `${message.type}: ${message.summary}`);
}

export interface ScriptCacheRunReport {
  query: string;
  sessionId: string | null;
  status: string;
  workspaceId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  llmCostUsd: string | null;
  browserCostUsd: string | null;
  proxyCostUsd: string | null;
  totalCostUsd: string | null;
  messageTypes: string[];
  messages: MessageResponse[];
  rawResult: unknown;
  parsedResult: z.infer<typeof wikipediaResultSchema> | null;
  validationError: string | null;
  modelInvoked: boolean | null;
  cacheEvidence: string[];
  error: string | null;
}

export interface ScriptCacheSpikeReport {
  apiVersion: "v3";
  sdkVersion: "3.11.3";
  workspaceId: string | null;
  cacheScript: true;
  autoHeal: false;
  deterministicReuseObserved: boolean;
  cacheHitReportedByApi: false;
  workspaceDeleted: boolean;
  runs: ScriptCacheRunReport[];
  error: string | null;
}

async function runOne(
  client: BrowserUse,
  workspaceId: string,
  query: string,
): Promise<ScriptCacheRunReport> {
  const wallStartedAt = Date.now();
  const messages: MessageResponse[] = [];
  const run = client.run(buildTask(query), {
    model: browserUseConfig.model,
    maxCostUsd: browserUseConfig.maxCostUsd,
    proxyCountryCode: browserUseConfig.proxyCountryCode,
    workspaceId,
    cacheScript: true,
    autoHeal: false,
    keepAlive: false,
    skills: false,
    agentmail: false,
    enableRecording: false,
    enableScheduledTasks: false,
    timeout: 5 * 60 * 1000,
  });

  let result: SessionResult | null = null;
  let runError: string | null = null;

  try {
    for await (const message of run) messages.push(message);
    result = run.result;
  } catch (error) {
    runError = errorMessage(error);
  } finally {
    if (run.sessionId) {
      try {
        await client.sessions.stop(run.sessionId, { strategy: "session" });
      } catch (error) {
        console.info("V3 script-cache session was already stopped", {
          sessionId: run.sessionId,
          error: errorMessage(error),
        });
      }
    }
  }

  const parsed = parseOutput(result?.output ?? null);
  const totalInputTokens = result?.totalInputTokens ?? null;
  const totalOutputTokens = result?.totalOutputTokens ?? null;
  const llmCostUsd = result?.llmCostUsd ?? null;

  return {
    query,
    sessionId: run.sessionId,
    status: result?.status ?? "error",
    workspaceId: result?.workspaceId ?? workspaceId,
    startedAt: result?.createdAt ?? null,
    completedAt: result?.updatedAt ?? null,
    elapsedMs: result
      ? Date.parse(result.updatedAt) - Date.parse(result.createdAt)
      : Date.now() - wallStartedAt,
    totalInputTokens,
    totalOutputTokens,
    llmCostUsd,
    browserCostUsd: result?.browserCostUsd ?? null,
    proxyCostUsd: result?.proxyCostUsd ?? null,
    totalCostUsd: result?.totalCostUsd ?? null,
    messageTypes: messages.map((message) => message.type),
    messages,
    rawResult: result?.output ?? null,
    parsedResult: parsed.parsedResult,
    validationError: parsed.validationError,
    modelInvoked:
      totalInputTokens === null || totalOutputTokens === null || llmCostUsd === null
        ? null
        : totalInputTokens > 0 || totalOutputTokens > 0 || Number(llmCostUsd) > 0,
    cacheEvidence: cacheEvidence(messages),
    error: runError,
  };
}

export async function runScriptCacheSpike(): Promise<ScriptCacheSpikeReport> {
  const { BROWSER_USE_API_KEY } = getBrowserUseEnv();
  const client = new BrowserUse({ apiKey: BROWSER_USE_API_KEY, maxRetries: 0 });
  let workspaceId: string | null = null;
  let workspaceDeleted = false;
  const runs: ScriptCacheRunReport[] = [];
  let spikeError: string | null = null;

  try {
    const workspace = await client.workspaces.create({
      name: `Replay script-cache spike ${new Date().toISOString()}`,
    });
    workspaceId = workspace.id;

    for (const query of queryValues) {
      const report = await runOne(client, workspaceId, query);
      runs.push(report);
      console.info("Browser Use V3 script-cache run", report);
      if (report.error) break;
    }
  } catch (error) {
    spikeError = errorMessage(error);
  } finally {
    if (workspaceId) {
      try {
        await client.workspaces.delete(workspaceId);
        workspaceDeleted = true;
      } catch (error) {
        spikeError ??= `Workspace cleanup failed: ${errorMessage(error)}`;
      }
    }
  }

  return {
    apiVersion: "v3",
    sdkVersion: "3.11.3",
    workspaceId,
    cacheScript: true,
    autoHeal: false,
    deterministicReuseObserved:
      runs.length === 2 &&
      runs[1].parsedResult !== null &&
      runs[1].totalInputTokens === 0 &&
      runs[1].totalOutputTokens === 0 &&
      Number(runs[1].llmCostUsd) === 0,
    cacheHitReportedByApi: false,
    workspaceDeleted,
    runs,
    error: spikeError,
  };
}
