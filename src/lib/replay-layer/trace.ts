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
): TraceEvent[] {
  return outcome.messages
    .filter((message) => message.summary.trim())
    .slice(-6)
    .map((message) => replayTrace(
      runId,
      "agent",
      /search/i.test(message.summary) ? "Searching…" : /extract/i.test(message.summary) ? "Extracting…" : "Agent update",
      message.summary.replace(/\/workspace\/[^\s]+/g, "the learned procedure"),
    ));
}
