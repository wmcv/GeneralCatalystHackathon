import type { RunEvent } from "browser-use-sdk/v4";
import { traceEventSchema, type TraceEvent } from "./types";

type TraceFields = Omit<TraceEvent, "id" | "runId" | "timestamp" | "rawEventType">;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeCoreEvent(event: RunEvent): TraceFields | null {
  const subtype = stringValue(event.data.type);
  const part = event.data.part;
  const partData = typeof part === "object" && part !== null ? part as Record<string, unknown> : {};
  const text = stringValue(partData.text);
  const tool = stringValue(partData.tool);

  if ((subtype === "reasoning" || subtype === "text") && text) {
    return {
      category: "reasoning",
      kind: subtype,
      label: subtype === "reasoning" ? "Agent reasoning" : "Agent update",
      detail: text,
      isAi: true,
    };
  }

  if (subtype === "tool_use" && tool === "browser_execute") {
    return {
      category: "browser",
      kind: "browser.tool",
      label: "Browsing the web",
      isAi: true,
      metadata: { tool },
    };
  }

  return null;
}

function fieldsForEvent(event: RunEvent): TraceFields | null {
  switch (event.type) {
    case "run.created":
      return { category: "lifecycle", kind: "run.created", label: "Run created", isAi: false };
    case "run.dispatching":
      return {
        category: "lifecycle",
        kind: "run.dispatching",
        label: "Preparing research",
        isAi: false,
      };
    case "run.dispatched":
      return {
        category: "lifecycle",
        kind: "run.dispatched",
        label: "Research started",
        isAi: false,
      };
    case "browser.ready": {
      const liveViewUrl = stringValue(event.data.live_view_url);
      return {
        category: "browser",
        kind: "browser.ready",
        label: "Browser ready",
        isAi: false,
        ...(liveViewUrl ? { metadata: { liveViewUrl } } : {}),
      };
    }
    case "llm.request":
      return {
        category: "reasoning",
        kind: "reasoning.requested",
        label: "Agent reasoning",
        isAi: true,
      };
    case "llm.response": {
      const inputTokens = numberValue(event.data.input_tokens);
      const outputTokens = numberValue(event.data.output_tokens);
      return {
        category: "reasoning",
        kind: "reasoning.completed",
        label: "Reasoning completed",
        isAi: true,
        ...(inputTokens !== undefined || outputTokens !== undefined
          ? { metadata: { inputTokens, outputTokens } }
          : {}),
      };
    }
    case "search.performed": {
      const query = stringValue(event.data.query);
      const resultCount = numberValue(event.data.num_results);
      return {
        category: "search",
        kind: "search.performed",
        label: query ? `Searching for ${query}` : "Web search performed",
        detail: resultCount === undefined ? undefined : `${resultCount} results returned`,
        isAi: false,
      };
    }
    case "state.promoted":
      return {
        category: "state",
        kind: "state.promoted",
        label: "Run state saved",
        isAi: false,
        metadata: event.data,
      };
    case "outputs.promoted":
      return {
        category: "result",
        kind: "outputs.promoted",
        label: "Output saved",
        isAi: false,
        metadata: event.data,
      };
    case "run.completed":
      return {
        category: "result",
        kind: "run.completed",
        label: "Research completed",
        isAi: false,
      };
    case "run.failed":
    case "run.dispatch_failed":
      return {
        category: "result",
        kind: event.type,
        label: "Research failed",
        detail: stringValue(event.data.error),
        isAi: false,
      };
    case "run.cancelled":
      return {
        category: "result",
        kind: "run.cancelled",
        label: "Research cancelled",
        isAi: false,
      };
    case "browser.released":
      return {
        category: "browser",
        kind: "browser.released",
        label: "Browser released",
        isAi: false,
      };
    case "core.event":
      return normalizeCoreEvent(event);
    default:
      return null;
  }
}

export function normalizeBrowserUseEvent(event: RunEvent): TraceEvent | null {
  const fields = fieldsForEvent(event);
  if (!fields) return null;

  return traceEventSchema.parse({
    id: `browser-use:${event.runId}:${event.id}`,
    runId: event.runId,
    timestamp: event.ts,
    rawEventType: event.type,
    ...fields,
  });
}

export function normalizeBrowserUseEvents(events: RunEvent[]): TraceEvent[] {
  return events
    .map(normalizeBrowserUseEvent)
    .filter((event): event is TraceEvent => event !== null)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}
