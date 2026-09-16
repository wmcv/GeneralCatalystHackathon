import type { DeterministicBrowserOutcome } from "../replay/deterministic-executor";
import { traceEventSchema, type TraceActor, type TraceEvent } from "../trace/types";

let sequence = 0;

export function replayTrace(
  runId: string,
  actor: TraceActor,
  label: string,
  detail?: string,
  metadata?: Record<string, unknown>,
): TraceEvent {
  sequence += 1;
  return traceEventSchema.parse({
    id: `${runId}:${sequence}`,
    runId,
    timestamp: new Date().toISOString(),
    actor,
    category: actor === "agent" || actor === "executor" ? "browser" : "lifecycle",
    kind: `${actor}.activity`,
    label,
    detail,
    isAi: actor === "replay" || actor === "agent",
    rawEventType: `${actor}.activity`,
    ...(metadata ? { metadata } : {}),
  });
}

export function browserMessageTrace(
  runId: string,
  outcome: DeterministicBrowserOutcome,
  actor: "agent" | "executor" = "agent",
): TraceEvent[] {
  return outcome.messages
    .map((message) => browserMessageEvent(runId, message, actor))
    .filter((event): event is TraceEvent => event !== null)
    .slice(-6);
}

function structuredSummary(summary: string): { label: string; detail?: string } | null {
  try {
    const value = JSON.parse(summary) as Record<string, unknown>;
    const repositories = Array.isArray(value.repositories) ? value.repositories : null;
    if (repositories) return { label: `Found ${repositories.length} qualifying repositories` };
    const items = Object.values(value).find(Array.isArray);
    if (items) return { label: `Research complete`, detail: `${items.length} structured results returned` };
    return { label: "Research complete" };
  } catch {
    return null;
  }
}

export function browserMessageEvent(
  runId: string,
  message: { type: string; summary: string; data: string },
  actor: "agent" | "executor" = "agent",
): TraceEvent | null {
  const summary = message.summary.trim();
  if (!summary) return null;
  const structured = structuredSummary(summary);
  const technicalDetails = { type: message.type, summary: message.summary, data: message.data };
  if (structured) return replayTrace(runId, actor, structured.label, structured.detail, { technicalDetails });
  const combined = `${message.type} ${summary}`;
  const label = /bash|python|script|code_execution/i.test(message.type)
    ? actor === "executor" ? "Running learned procedure…" : "Building and testing procedure…"
    : /fetch/i.test(message.type)
      ? "Inspecting sources…"
      : /web[_ ]?search|search|find/i.test(combined)
        ? "Searching the web…"
        : /inspect|visit|open|browse/i.test(combined)
          ? "Inspecting sources…"
          : /filter|constraint|star/i.test(combined)
            ? "Filtering results…"
            : /extract|collect|parse/i.test(combined)
              ? "Extracting…"
              : "Agent working…";
  return replayTrace(
    runId,
    actor,
    label,
    undefined,
    { technicalDetails },
  );
}
