import { describe, expect, it } from "vitest";
import { browserUseEventFixtures } from "./__fixtures__/browser-use-events";
import { normalizeBrowserUseEvent, normalizeBrowserUseEvents } from "./normalize-browser-use";

describe("normalizeBrowserUseEvents", () => {
  it("creates a chronological provider-neutral trace", () => {
    const trace = normalizeBrowserUseEvents(browserUseEventFixtures);

    expect(trace.map((event) => event.label)).toEqual([
      "Browser ready",
      "Agent update",
      "Web search performed",
      "Research completed",
    ]);
    expect(trace[0]).toMatchObject({
      category: "browser",
      isAi: false,
      metadata: { liveViewUrl: "https://live.browser-use.com?example=fixture" },
    });
    expect(trace[1]).toMatchObject({
      category: "reasoning",
      detail: "Checking current manufacturer listings.",
      isAi: true,
    });
    expect(trace[2].detail).toBe("10 results returned");
  });

  it("uses an explicit search query when Browser Use supplies one", () => {
    const event = normalizeBrowserUseEvent({
      ...browserUseEventFixtures[0],
      data: { query: "mechanical keyboards", num_results: 3 },
    });

    expect(event?.label).toBe("Searching for mechanical keyboards");
  });

  it("ignores core step boundaries without semantic content", () => {
    expect(normalizeBrowserUseEvent(browserUseEventFixtures[3])).toBeNull();
  });
});
