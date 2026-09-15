import "server-only";

import { BrowserUse, type RunEvent, type RunSummary } from "browser-use-sdk/v4";
import { browserUseConfig, getBrowserUseEnv } from "../browser-use/config";
import { saveRunEvents } from "../browser-use/event-store";
import { browserUseSpikeResultSchema } from "../browser-use/types";
import { normalizeBrowserUseEvents } from "../trace/normalize-browser-use";
import type { BrowserExecutionOutcome } from "./execute-capability";

async function collectEvents(client: BrowserUse, runId: string): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  let after: number | null = null;
  do {
    const page = await client.runs.events(runId, { after, limit: 100 });
    events.push(...page.events);
    after = page.hasMore ? (page.nextAfter ?? null) : null;
  } while (after !== null);
  return events;
}

function browserDetails(events: RunEvent[]) {
  const ready = events.find((event) => event.type === "browser.ready");
  return {
    liveViewUrl: typeof ready?.data.live_view_url === "string" ? ready.data.live_view_url : null,
    browserSessionId:
      typeof ready?.data.browser_session_id === "string" ? ready.data.browser_session_id : null,
  };
}

function parseStructuredResult(rawResult: string | null) {
  if (!rawResult) return { structuredResult: null, validationError: "Browser Use returned no result." };
  try {
    const result = browserUseSpikeResultSchema.safeParse(JSON.parse(rawResult));
    return result.success
      ? { structuredResult: result.data, validationError: null }
      : { structuredResult: null, validationError: result.error.message };
  } catch (error) {
    return {
      structuredResult: null,
      validationError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runBrowserUseExecution(task: string): Promise<BrowserExecutionOutcome> {
  const wallStart = Date.now();
  const { BROWSER_USE_API_KEY } = getBrowserUseEnv();
  const client = new BrowserUse({ apiKey: BROWSER_USE_API_KEY, maxRetries: 0 });
  let runId: string | null = null;
  let run: RunSummary | null = null;
  let events: RunEvent[] = [];

  try {
    const created = await client.runs.create({
      task,
      model: browserUseConfig.model,
      maxCostUsd: browserUseConfig.maxCostUsd,
      browserSettings: { proxyCountryCode: browserUseConfig.proxyCountryCode },
    });
    runId = created.id;
    console.info("Replay Browser Use run created", { runId });
    run = await client.runs.waitForCompletion(runId, { timeout: 15 * 60 * 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Replay Browser Use run failed", { runId, error });
    return {
      runId,
      status: run?.status ?? "failed",
      createdAt: run?.createdAt ?? null,
      updatedAt: run?.updatedAt ?? null,
      elapsedMs: Date.now() - wallStart,
      totalInputTokens: run?.totalInputTokens ?? null,
      totalOutputTokens: run?.totalOutputTokens ?? null,
      totalCostUsd: run?.totalCostUsd ?? null,
      rawResult: run?.result ?? null,
      structuredResult: null,
      validationError: null,
      error: message,
      liveViewUrl: null,
      traceEvents: [],
    };
  } finally {
    if (runId) {
      try {
        events = await collectEvents(client, runId);
        saveRunEvents(runId, events);
        const { browserSessionId } = browserDetails(events);
        if (browserSessionId) await client.browsers.stop(browserSessionId);
      } catch (cleanupError) {
        console.error("Replay Browser Use cleanup failed", { runId, cleanupError });
      }
    }
  }

  const { liveViewUrl } = browserDetails(events);
  const parsed = parseStructuredResult(run.result);
  return {
    runId: run.id,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    elapsedMs: Date.parse(run.updatedAt) - Date.parse(run.createdAt),
    totalInputTokens: run.totalInputTokens,
    totalOutputTokens: run.totalOutputTokens,
    totalCostUsd: run.totalCostUsd,
    rawResult: run.result,
    ...parsed,
    error: run.error,
    liveViewUrl,
    traceEvents: normalizeBrowserUseEvents(events),
  };
}
