import "server-only";

import { BrowserUse, type MessageResponse, type SessionResult } from "browser-use-sdk/v3";
import type { BrowserUseCachedScriptExecution } from "../domain/capability";
import type { DeterministicBrowserOutcome } from "../replay/deterministic-executor";
import { browserUseConfig, getBrowserUseEnv } from "./config";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseResult(output: unknown) {
  try {
    return {
      structuredResult: typeof output === "string" ? JSON.parse(output) : output,
      validationError: null,
    };
  } catch (error) {
    return { structuredResult: null, validationError: message(error) };
  }
}

export function containsGeneratedScript(
  messages: Array<{ type: string; summary: string; data: string }>,
): boolean {
  return messages.some(
    (item) => item.type === "code_execution" &&
      /\/workspace\/scripts\//.test(`${item.summary} ${item.data}`),
  );
}

export async function getBrowserUseV3SessionMessages(
  sessionId: string,
): Promise<Array<{ type: string; summary: string; data: string }>> {
  const { BROWSER_USE_API_KEY } = getBrowserUseEnv();
  const client = new BrowserUse({ apiKey: BROWSER_USE_API_KEY, maxRetries: 0 });
  const messages: MessageResponse[] = [];
  let after: string | null = null;
  do {
    const page = await client.sessions.messages(sessionId, { after, limit: 100 });
    messages.push(...page.messages);
    after = page.messages.length === 100 ? page.messages.at(-1)?.id ?? null : null;
  } while (after);
  return messages.map(({ type, summary, data }) => ({ type, summary, data }));
}

export async function runDeterministicBrowserUseV3(
  execution: BrowserUseCachedScriptExecution,
  task: string,
  onMessage?: (message: { type: string; summary: string; data: string }) => void,
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
    for await (const runMessage of run) {
      messages.push(runMessage);
      onMessage?.({
        type: runMessage.type,
        summary: runMessage.summary,
        data: runMessage.data,
      });
    }
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
    scriptGenerated: containsGeneratedScript(messages),
    rawResult: result?.output ?? null,
    ...parsed,
    error,
  };
}
