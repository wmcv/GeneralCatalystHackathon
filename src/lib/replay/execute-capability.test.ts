import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserUseSpikeResult } from "../browser-use/types";
import type { SemanticCapability } from "../domain/capability";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import { createInMemoryRunStore } from "../state/run-store";
import { buildCapabilityExecutionTask } from "./build-execution-task";
import {
  executeCapability,
  type BrowserExecutionOutcome,
} from "./execute-capability";

const capability: SemanticCapability = {
  id: "comparative-product-research:run-1",
  name: "comparative_product_research",
  description: "Research and compare products.",
  intentSignature: "comparative_product_research(product_type, max_price, currency, use_case, result_count)",
  family: "comparative_product_research",
  version: 1,
  parameters: [
    { name: "product_type", type: "string", required: true, description: "Product type." },
    { name: "max_price", type: "number", required: true, description: "Maximum price." },
    { name: "currency", type: "string", required: true, description: "Currency." },
    { name: "use_case", type: "string", required: true, description: "Use case." },
    { name: "result_count", type: "number", required: true, description: "Result count." },
  ],
  strategy: [
    {
      stage: "Discover candidates",
      objective: "Find plausible products.",
      preferredEvidence: ["Listings"],
      completionCondition: "Candidates exist.",
    },
    {
      stage: "Enforce constraints",
      objective: "Remove candidates over budget.",
      preferredEvidence: ["Prices"],
      completionCondition: "All candidates comply.",
    },
  ],
  invariants: ["Every recommendation satisfies the stated hard constraints."],
  fallbackTriggers: ["Current prices cannot be verified."],
  learnedFromRunId: "run-1",
  learnedByAgentId: "Agent 01",
  scope: "organization",
  createdAt: "2026-09-15T15:11:47.648Z",
  successfulUses: 0,
  deterministicUses: 0,
  executionState: "semantic",
  sourceExample: {},
};

const products: BrowserUseSpikeResult["products"] = Array.from({ length: 4 }, (_, index) => ({
  name: `Mouse ${index + 1}`,
  price: `$${80 + index}`,
  url: `https://example.com/mouse-${index + 1}`,
  whySuitable: "Ergonomic and programmable.",
}));

const successfulOutcome: BrowserExecutionOutcome = {
  runId: "replay-run-1",
  status: "completed",
  createdAt: "2026-09-15T16:00:00.000Z",
  updatedAt: "2026-09-15T16:01:00.000Z",
  elapsedMs: 60_000,
  totalInputTokens: 100,
  totalOutputTokens: 50,
  totalCostUsd: "0.01",
  rawResult: "{}",
  structuredResult: { summary: "Four mice.", products, sources: [], limitations: [] },
  validationError: null,
  error: null,
  liveViewUrl: null,
  traceEvents: [],
};

describe("capability execution", () => {
  const registry = createInMemoryCapabilityRegistry();
  const runStore = createInMemoryRunStore();

  beforeEach(() => {
    registry.clearForTests();
    runStore.clearForTests();
    registry.addCapability(capability);
  });

  it("builds the execution task from learned strategy and invariants", () => {
    const task = buildCapabilityExecutionTask(capability, {
      product_type: "ergonomic mice",
      max_price: 120,
      currency: "USD",
      use_case: "programming",
      result_count: 4,
    });
    expect(task).toContain("1. Discover candidates");
    expect(task).toContain("2. Enforce constraints");
    expect(task).toContain("Every recommendation satisfies the stated hard constraints.");
    expect(task).toContain("Current prices cannot be verified.");
  });

  it("includes extracted parameters in the execution task", () => {
    const task = buildCapabilityExecutionTask(capability, {
      product_type: "ergonomic mice",
      max_price: 120,
      currency: "USD",
      use_case: "programming",
      result_count: 4,
    });
    expect(task).toContain("product_type = ergonomic mice");
    expect(task).toContain("max_price = 120");
    expect(task).toContain("result_count = 4");
  });

  it("does not invoke Browser Use when no capability matches", async () => {
    registry.clearForTests();
    const runBrowserTask = vi.fn();
    const result = await executeCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runStore, runBrowserTask },
    );
    expect(result.matched).toBe(false);
    expect(runBrowserTask).not.toHaveBeenCalled();
  });

  it("increments successful uses after successful validated execution", async () => {
    await executeCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runStore, runBrowserTask: vi.fn().mockResolvedValue(successfulOutcome) },
    );
    expect(registry.getCapabilityById(capability.id)?.successfulUses).toBe(1);
    expect(runStore.get("replay-run-1")).toMatchObject({
      mode: "replay",
      requestingAgentId: "Agent 02",
      capabilityId: capability.id,
    });
  });

  it("does not increment successful uses when validation fails", async () => {
    const invalid = { ...successfulOutcome, structuredResult: null, validationError: "Invalid JSON" };
    await executeCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runStore, runBrowserTask: vi.fn().mockResolvedValue(invalid) },
    );
    expect(registry.getCapabilityById(capability.id)?.successfulUses).toBe(0);
  });

  it("invokes Browser Use at most once per execution request", async () => {
    const runBrowserTask = vi.fn().mockResolvedValue(successfulOutcome);
    await executeCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runStore, runBrowserTask },
    );
    expect(runBrowserTask).toHaveBeenCalledTimes(1);
  });
});
