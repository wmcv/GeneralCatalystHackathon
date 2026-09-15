import { describe, expect, it } from "vitest";
import { browserUseSpikeResultSchema } from "../browser-use/types";
import type { ReplayRun } from "../domain/run";
import { createInMemoryRunStore } from "../state/run-store";
import {
  CapabilityCompilationError,
  compileProductResearchCapability,
  compileStoredDiscoveryRun,
} from "./compiler";

const completedRun: ReplayRun = {
  id: "run-1",
  task: "Find three mechanical keyboards under $180 USD suitable for programming.",
  mode: "discovery",
  status: "completed",
  startedAt: "2026-09-15T15:10:18.727Z",
  completedAt: "2026-09-15T15:11:47.648Z",
};

const structuredResult = browserUseSpikeResultSchema.parse({
  summary: "Three suitable keyboards.",
  products: [
    { name: "Keyboard A", price: "$100", url: "https://example.com/a", whySuitable: "Programmable." },
    { name: "Keyboard B", price: "$120", url: "https://example.com/b", whySuitable: "Compact." },
    { name: "Keyboard C", price: "$140", url: "https://example.com/c", whySuitable: "Ergonomic." },
  ],
  sources: [{ url: "https://example.com/a", description: "Manufacturer listing." }],
  limitations: ["Prices can change."],
});

describe("capability compiler", () => {
  it("compiles the successful discovery into a parameterized semantic capability", () => {
    const capability = compileProductResearchCapability(completedRun, structuredResult, "Agent 01");

    expect(capability.name).toBe("comparative_product_research");
    expect(capability.scope).toBe("organization");
    expect(capability.parameters.map((parameter) => parameter.name)).toEqual([
      "product_type", "max_price", "currency", "use_case", "result_count",
    ]);
    expect(capability.strategy).toHaveLength(5);
    expect(capability.sourceExample).toEqual({
      product_type: "mechanical keyboards",
      max_price: 180,
      currency: "USD",
      use_case: "programming",
      result_count: 3,
    });
  });

  it("contains no Browser Use implementation details", () => {
    const capability = compileProductResearchCapability(completedRun, structuredResult, "Agent 01");
    const serialized = JSON.stringify(capability).toLowerCase();

    expect(serialized).not.toMatch(/browser\.ready|core\.event|selector|coordinate/);
  });

  it("uses a stable capability id when the same run is compiled twice", () => {
    const first = compileProductResearchCapability(completedRun, structuredResult, "Agent 01");
    const second = compileProductResearchCapability(completedRun, structuredResult, "Agent 01");
    expect(first.id).toBe(second.id);
  });

  it("rejects unknown and failed runs", () => {
    const store = createInMemoryRunStore();
    expect(() => compileStoredDiscoveryRun({ runId: "missing", learnedByAgentId: "Agent 01" }, store))
      .toThrow(CapabilityCompilationError);

    store.save({ ...completedRun, id: "failed", status: "failed" });
    store.saveResult("failed", structuredResult);
    expect(() => compileStoredDiscoveryRun({ runId: "failed", learnedByAgentId: "Agent 01" }, store))
      .toThrow("Only completed discovery runs can be compiled.");

    store.save({ ...completedRun, id: "missing-result" });
    expect(() => compileStoredDiscoveryRun(
      { runId: "missing-result", learnedByAgentId: "Agent 01" },
      store,
    )).toThrow("The discovery run has no validated structured result.");
  });
});
