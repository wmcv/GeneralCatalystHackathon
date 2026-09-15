import "server-only";

import type { RunEvent } from "browser-use-sdk/v4";

const eventsByRun = new Map<string, RunEvent[]>();

export function saveRunEvents(runId: string, events: RunEvent[]): void {
  eventsByRun.set(runId, events);
}

export function getRunEvents(runId: string): RunEvent[] {
  return eventsByRun.get(runId) ?? [];
}
