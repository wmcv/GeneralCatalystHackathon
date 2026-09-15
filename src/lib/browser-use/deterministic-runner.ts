import "server-only";

import { BrowserUse, type MessageResponse, type SessionResult } from "browser-use-sdk/v3";
import type { BrowserUseCachedScriptExecution } from "../domain/capability";
import type { DeterministicBrowserOutcome } from "../replay/deterministic-executor";
import { browserUseConfig, getBrowserUseEnv } from "./config";
import { browserUseSpikeResultSchema } from "./types";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseResult(output: unknown) {
  try {
    const value = typeof output === "string" ? JSON.parse(output) : output;
    const parsed = browserUseSpikeResultSchema.safeParse(value);
    return parsed.success
      ? { structuredResult: parsed.data, validationError: null }
      : { structuredResult: null, validationError: parsed.error.message };
  } catch (error) {
    return { structuredResult: null, validationError: message(error) };
  }
}

export async function runDeterministicBrowserUseV3(
  execution: BrowserUseCachedScriptExecution,
  task: string,
): Promise<DeterministicBrowserOutcome> {
  const wallStartedAt = Date.now();
  const { BROWSER_USE_API_KEY } = getBrowserUseEnv();
  const client = new BrowserUse({ apiKey: BROWSER_USE_API_KEY, maxRetries: 0 });
  const run = client.run(task, {
    model: browserUseConfig.model,
    maxCostUsd: browserUseConfig.maxCostUsd,
    proxyCountryCode: browserUseConfig.proxyCountryCode,
    workspaceId: execution.workspaceId,
    cacheScript: execution.cacheScript,
    autoHeal: execution.autoHeal,
    keepAlive: false,
    skills: false,
    agentmail: false,
    enableRecording: false,
    enableScheduledTasks: false,
    timeout: 15 * 60 * 1000,
  });

  let result: SessionResult | null = null;
  let error: string | null = null;
  const messages: MessageResponse[] = [];
  try {
    for await (const runMessage of run) messages.push(runMessage);
    result = run.result;
  } catch (runError) {
    error = message(runError);
  } finally {
    if (run.sessionId) {
      try {
        await client.sessions.stop(run.sessionId, { strategy: "session" });
      } catch (stopError) {
        console.info("Deterministic Browser Use session was already stopped", {
          sessionId: run.sessionId,
          error: message(stopError),
        });
      }
    }
  }

  const parsed = parseResult(result?.output ?? null);
  return {
    sessionId: run.sessionId,
    status: result?.status ?? "error",
    isTaskSuccessful: result?.isTaskSuccessful ?? null,
    elapsedMs: result
      ? Date.parse(result.updatedAt) - Date.parse(result.createdAt)
      : Date.now() - wallStartedAt,
    totalInputTokens: result?.totalInputTokens ?? null,
    totalOutputTokens: result?.totalOutputTokens ?? null,
    llmCostUsd: result?.llmCostUsd ?? null,
    browserCostUsd: result?.browserCostUsd ?? null,
    proxyCostUsd: result?.proxyCostUsd ?? null,
    totalCostUsd: result?.totalCostUsd ?? null,
    messages: messages.map(({ type, summary, data }) => ({ type, summary, data })),
    scriptGenerated: messages.some(
      (item) => item.type === "code_execution" && /\/workspace\/scripts\//.test(item.data),
    ),
    rawResult: result?.output ?? null,
    ...parsed,
    error,
  };
}
