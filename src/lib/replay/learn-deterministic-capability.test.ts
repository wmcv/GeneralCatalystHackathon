import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import type { SemanticCapability } from "../domain/capability";
import { createInMemoryRunStore } from "../state/run-store";
import type { DeterministicBrowserOutcome } from "./deterministic-executor";
import { learnDeterministicCapability } from "./learn-deterministic-capability";

const semanticCapability: SemanticCapability = {
  id: "capability-1",
  name: "comparative_product_research",
  description: "Compare products.",
  intentSignature: "comparative_product_research(product_type, max_price, currency, use_case, result_count)",
  family: "comparative_product_research",
  version: 1,
  parameters: [
    { name: "product_type", type: "string", required: true, description: "Product type." },
    { name: "max_price", type: "number", required: true, description: "Maximum price." },
    { name: "currency", type: "string", required: true, description: "Currency." },
    { name: "use_case", type: "string", required: true, description: "Use case." },
    { name: "result_count", type: "number", required: true, description: "Count." },
  ],
  strategy: [],
  invariants: [],
  fallbackTriggers: [],
  learnedFromRunId: "run-1",
  learnedByAgentId: "Agent 01",
  scope: "organization",
  createdAt: "2026-09-15T16:00:00.000Z",
  successfulUses: 0,
  deterministicUses: 0,
  executionState: "semantic",
  sourceExample: {},
};

const outcome: DeterministicBrowserOutcome = {
  sessionId: "session-1",
  status: "stopped",
  isTaskSuccessful: true,
  elapsedMs: 10_000,
  totalInputTokens: 100,
  totalOutputTokens: 10,
  llmCostUsd: "0.01",
  browserCostUsd: "0.001",
  proxyCostUsd: "0",
  totalCostUsd: "0.011",
  messages: [{ type: "code_execution", summary: "Write script", data: "/workspace/scripts/a.py" }],
  scriptGenerated: true,
  rawResult: {},
  structuredResult: {
    summary: "Three keyboards.",
    products: Array.from({ length: 3 }, (_, index) => ({
      name: `Keyboard ${index}`,
      price: "$100",
      url: `https://example.com/${index}`,
      whySuitable: "Suitable.",
    })),
    sources: [],
    limitations: [],
  },
  validationError: null,
  error: null,
};

describe("deterministic capability learning", () => {
  const registry = createInMemoryCapabilityRegistry();
  const runStore = createInMemoryRunStore();
  const sourceParameters = {
    product_type: "mechanical keyboards",
    max_price: 180,
    currency: "USD",
    use_case: "programming",
    result_count: 3,
  };

  beforeEach(() => {
    registry.clearForTests();
    runStore.clearForTests();
    registry.addCapability(semanticCapability);
  });

  it("moves semantic through learning to ready and preserves its workspace", async () => {
    const runBrowserUseV3 = vi.fn().mockResolvedValue(outcome);
    const deleteWorkspace = vi.fn();
    const result = await learnDeterministicCapability(semanticCapability, sourceParameters, {
      registry,
      runStore,
      createWorkspace: vi.fn().mockResolvedValue({ id: "workspace-1" }),
      deleteWorkspace,
      runBrowserUseV3,
    });

    expect(result).toMatchObject({ deterministicReady: true, workspacePreserved: true });
    expect(result.capability).toMatchObject({
      executionState: "deterministic_ready",
      execution: { workspaceId: "workspace-1", deterministicReady: true },
    });
    expect(runBrowserUseV3).toHaveBeenCalledOnce();
    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(runStore.get("session-1")).toMatchObject({
      executionPhase: "learning",
      requestingAgentId: "Agent 01",
    });
  });

  it("does not become ready and removes the failed workspace", async () => {
    const deleteWorkspace = vi.fn();
    const result = await learnDeterministicCapability(semanticCapability, sourceParameters, {
      registry,
      runStore,
      createWorkspace: vi.fn().mockResolvedValue({ id: "workspace-1" }),
      deleteWorkspace,
      runBrowserUseV3: vi.fn().mockResolvedValue({ ...outcome, scriptGenerated: false }),
    });

    expect(result).toMatchObject({ deterministicReady: false, workspacePreserved: false });
    expect(registry.getCapabilityById(semanticCapability.id)).toMatchObject({
      executionState: "semantic",
    });
    expect(deleteWorkspace).toHaveBeenCalledWith("workspace-1");
  });
});
