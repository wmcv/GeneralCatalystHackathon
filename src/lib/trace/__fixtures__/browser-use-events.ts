import type { RunEvent } from "browser-use-sdk/v4";

const runId = "8d422d46-d68f-4487-9033-1fd63bca4f32";

export const browserUseEventFixtures: RunEvent[] = [
  {
    runId,
    id: 3,
    ts: "2026-09-15T15:10:31.396302Z",
    type: "search.performed",
    data: { cost_usd: 0.007, duration_ms: 1597, num_results: 10 },
  },
  {
    runId,
    id: 1,
    ts: "2026-09-15T15:10:19.157026Z",
    type: "browser.ready",
    data: {
      live_view_url: "https://live.browser-use.com?example=fixture",
      browser_session_id: "browser-fixture",
    },
  },
  {
    runId,
    id: 2,
    ts: "2026-09-15T15:10:25.928709Z",
    type: "core.event",
    data: {
      type: "text",
      part: { type: "text", text: "Checking current manufacturer listings." },
    },
  },
  {
    runId,
    id: 4,
    ts: "2026-09-15T15:10:32.000000Z",
    type: "core.event",
    data: { type: "step_start", part: { type: "step-start" } },
  },
  {
    runId,
    id: 5,
    ts: "2026-09-15T15:11:47.652905Z",
    type: "run.completed",
    data: {},
  },
];
