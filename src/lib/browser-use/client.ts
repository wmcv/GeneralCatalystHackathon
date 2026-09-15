import "server-only";

import { BrowserUse, type RunEvent, type RunSummary } from "browser-use-sdk/v4";
import { browserUseConfig, getBrowserUseEnv } from "./config";
import { saveRunEvents } from "./event-store";
import {
  browserUseSpikeResultSchema,
  type BrowserUseSpikeResponse,
} from "./types";

const SPIKE_TASK = `Find three mechanical keyboards under $180 USD that are
suitable for programming.

Research the live web.
Prefer credible product/manufacturer sources.
Do not purchase anything or log into any account.

Return JSON only with:

{
  "summary": "string",
  "products": [
    {
      "name": "string",
      "price": "string",
      "url": "https://...",
      "whySuitable": "string"
    }
  ],
  "sources": [
    {
      "url": "https://...",
      "description": "string"
    }
  ],
  "limitations": ["string"]
}`;

async function getAllRunEvents(client: BrowserUse, runId: string): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  let after: number | null = null;

  do {
    const page = await client.runs.events(runId, { after, limit: 100 });
    events.push(...page.events);
    after = page.hasMore ? (page.nextAfter ?? null) : null;
  } while (after !== null);

  return events;
}

function parseResult(rawResult: string | null) {
  if (rawResult === null) {
    return { parsedResult: null, validationError: "Browser Use returned no result." };
  }

  try {
    const parsedJson: unknown = JSON.parse(rawResult);
    const validated = browserUseSpikeResultSchema.safeParse(parsedJson);

    if (!validated.success) {
      return { parsedResult: null, validationError: validated.error.message };
    }

    return { parsedResult: validated.data, validationError: null };
  } catch (error) {
    return {
      parsedResult: null,
      validationError: error instanceof Error ? error.message : String(error),
    };
  }
}

function getBrowserEventDetails(events: RunEvent[]) {
  for (const event of events) {
    if (event.type !== "browser.ready") continue;
    const liveViewUrl = event.data.live_view_url;
    const browserSessionId = event.data.browser_session_id;
    return {
      liveViewUrl: typeof liveViewUrl === "string" ? liveViewUrl : null,
      browserSessionId: typeof browserSessionId === "string" ? browserSessionId : null,
    };
  }
  return { liveViewUrl: null, browserSessionId: null };
}

export async function runBrowserUseSpike(): Promise<BrowserUseSpikeResponse> {
  const startedAtMs = Date.now();
  let runId: string | null = null;
  let run: RunSummary | null = null;
  let events: RunEvent[] = [];

  try {
    const { BROWSER_USE_API_KEY } = getBrowserUseEnv();
    const client = new BrowserUse({ apiKey: BROWSER_USE_API_KEY, maxRetries: 0 });
    const created = await client.runs.create({
      task: SPIKE_TASK,
      model: browserUseConfig.model,
      maxCostUsd: browserUseConfig.maxCostUsd,
      browserSettings: { proxyCountryCode: browserUseConfig.proxyCountryCode },
    });
    runId = created.id;
    console.info("Browser Use spike created", { runId, eventsUrl: created.eventsUrl });

    run = await client.runs.waitForCompletion(runId, { timeout: 15 * 60 * 1000 });

    try {
      events = await getAllRunEvents(client, runId);
      saveRunEvents(runId, events);
      for (const event of events) console.info("Browser Use event", event);
    } catch (eventError) {
      console.error("Unable to retrieve Browser Use events", eventError);
    }

    const { liveViewUrl, browserSessionId } = getBrowserEventDetails(events);
    console.info("Browser Use live view", { exists: liveViewUrl !== null, url: liveViewUrl });
    if (browserSessionId) {
      try {
        await client.browsers.stop(browserSessionId);
        console.info("Browser Use browser stopped", { browserSessionId });
      } catch (stopError) {
        console.error("Unable to stop Browser Use browser", { browserSessionId, stopError });
      }
    }

    const { parsedResult, validationError } = parseResult(run.result);
    return {
      runId,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      elapsedMs: Date.parse(run.updatedAt) - Date.parse(run.createdAt),
      totalInputTokens: run.totalInputTokens,
      totalOutputTokens: run.totalOutputTokens,
      totalCostUsd: run.totalCostUsd,
      rawResult: run.result,
      parsedResult,
      validationError,
      error: run.error,
      eventTypes: events.map((event) => event.type),
      liveViewUrlObserved: liveViewUrl !== null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Browser Use spike failed", { runId, error });
    return {
      runId,
      status: run?.status ?? "failed",
      createdAt: run?.createdAt ?? null,
      updatedAt: run?.updatedAt ?? null,
      elapsedMs: Date.now() - startedAtMs,
      totalInputTokens: run?.totalInputTokens ?? null,
      totalOutputTokens: run?.totalOutputTokens ?? null,
      totalCostUsd: run?.totalCostUsd ?? null,
      rawResult: run?.result ?? null,
      parsedResult: null,
      validationError: null,
      error: message,
      eventTypes: events.map((event) => event.type),
      liveViewUrlObserved: false,
    };
  }
}
