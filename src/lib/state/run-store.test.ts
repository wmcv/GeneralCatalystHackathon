import { describe, expect, it } from "vitest";
import { createInMemoryRunStore } from "./run-store";

describe("run store cleanup", () => {
  it("removes capability runs and their results without touching other runs", () => {
    const store = createInMemoryRunStore();
    const baseRun = {
      task: "Research repositories",
      mode: "discovery" as const,
      status: "completed" as const,
      startedAt: "2026-09-15T16:00:00.000Z",
      capabilityId: "capability-1",
    };
    store.save({ ...baseRun, id: "run-1" });
    store.save({ ...baseRun, id: "run-2", capabilityId: "capability-2" });
    store.saveResult("run-1", { repositories: [] });
    store.saveResult("run-2", { repositories: [] });

    expect(store.removeByCapabilityId("capability-1")).toBe(1);
    expect(store.get("run-1")).toBeUndefined();
    expect(store.getResult("run-1")).toBeUndefined();
    expect(store.get("run-2")).toBeDefined();
    expect(store.getResult("run-2")).toBeDefined();
  });
});
