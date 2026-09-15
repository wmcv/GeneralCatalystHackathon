import { beforeEach, describe, expect, it, vi } from "vitest";
import { comparativeProductResearchTaskTemplate } from "../browser-use/capability-templates";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import type { SemanticCapability } from "../domain/capability";
import {
  executeRoutedDeterministicCapability,
  renderCachedScriptTask,
  type DeterministicBrowserOutcome,
} from "./deterministic-executor";

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
  strategy: [],
  invariants: [],
  fallbackTriggers: [],
  learnedFromRunId: "run-1",
  learnedByAgentId: "Agent 01",
  scope: "organization",
  createdAt: "2026-09-15T15:11:47.648Z",
  successfulUses: 0,
  deterministicUses: 0,
  executionState: "deterministic_ready",
  execution: {
    provider: "browser-use-v3",
    mode: "cached-script",
    workspaceId: "workspace-1",
    taskTemplate: comparativeProductResearchTaskTemplate,
    cacheScript: true,
    autoHeal: false,
    deterministicReady: true,
  },
  sourceExample: {},
};

const successfulOutcome: DeterministicBrowserOutcome = {
  sessionId: "session-1",
  status: "stopped",
  isTaskSuccessful: true,
  elapsedMs: 2_388,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  llmCostUsd: "0",
  browserCostUsd: "0.0003333333",
  proxyCostUsd: "0",
  totalCostUsd: "0.0003333333",
  rawResult: {},
  structuredResult: {
    summary: "Four mice.",
    products: Array.from({ length: 4 }, (_, index) => ({
      name: `Mouse ${index + 1}`,
      price: `$${80 + index}`,
      url: `https://example.com/mouse-${index + 1}`,
      whySuitable: "Ergonomic.",
    })),
    sources: [],
    limitations: [],
  },
  validationError: null,
  error: null,
};

describe("deterministic capability execution", () => {
  const registry = createInMemoryCapabilityRegistry();

  beforeEach(() => {
    registry.clearForTests();
    registry.addCapability(capability);
  });

  it("keeps provider details out of semantic knowledge", () => {
    const { execution, ...semanticKnowledge } = capability;
    expect(execution?.provider).toBe("browser-use-v3");
    expect(JSON.stringify(semanticKnowledge)).not.toContain("browser-use-v3");
  });

  it("keeps one stable template while changing only Browser Use parameter values", () => {
    const mice = renderCachedScriptTask(capability, {
      product_type: "ergonomic mice", max_price: 120, currency: "USD", use_case: "programming", result_count: 4,
    });
    const monitors = renderCachedScriptTask(capability, {
      product_type: "monitors", max_price: 500, currency: "CAD", use_case: "development", result_count: 3,
    });

    expect(capability.execution?.taskTemplate).toBe(comparativeProductResearchTaskTemplate);
    expect(mice).toContain("Research @{{4}} @{{ergonomic mice}} under @{{USD}} @{{120}} for @{{programming}}.");
    expect(monitors).toContain("Research @{{3}} @{{monitors}} under @{{CAD}} @{{500}} for @{{development}}.");
  });

  it("passes a non-healing cached-script descriptor to the V3 runner", async () => {
    const runBrowserUseV3 = vi.fn().mockResolvedValue(successfulOutcome);
    await executeRoutedDeterministicCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runBrowserUseV3 },
    );
    expect(runBrowserUseV3).toHaveBeenCalledOnce();
    expect(runBrowserUseV3.mock.calls[0][0]).toMatchObject({
      provider: "browser-use-v3",
      cacheScript: true,
      autoHeal: false,
      workspaceId: "workspace-1",
    });
  });

  it("increments both usage counters after a validated deterministic success", async () => {
    await executeRoutedDeterministicCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runBrowserUseV3: vi.fn().mockResolvedValue(successfulOutcome) },
    );
    expect(registry.getCapabilityById(capability.id)).toMatchObject({
      successfulUses: 1,
      deterministicUses: 1,
    });
  });

  it("does not increment usage after failure", async () => {
    await executeRoutedDeterministicCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runBrowserUseV3: vi.fn().mockResolvedValue({ ...successfulOutcome, isTaskSuccessful: false }) },
    );
    expect(registry.getCapabilityById(capability.id)).toMatchObject({
      successfulUses: 0,
      deterministicUses: 0,
    });
  });

  it("does not count an unexpected LLM execution as deterministic usage", async () => {
    await executeRoutedDeterministicCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      {
        registry,
        runBrowserUseV3: vi.fn().mockResolvedValue({
          ...successfulOutcome,
          totalInputTokens: 100,
          totalOutputTokens: 10,
          llmCostUsd: "0.01",
        }),
      },
    );
    expect(registry.getCapabilityById(capability.id)).toMatchObject({
      successfulUses: 1,
      deterministicUses: 0,
    });
  });

  it("rejects a capability that is not deterministic-ready", async () => {
    registry.clearForTests();
    registry.addCapability({
      ...capability,
      executionState: "learning",
      execution: { ...capability.execution!, deterministicReady: false },
    });
    const runBrowserUseV3 = vi.fn();
    const result = await executeRoutedDeterministicCapability(
      { task: "Find four ergonomic mice under $120 USD for programming", requestingAgentId: "Agent 02" },
      { registry, runBrowserUseV3 },
    );
    expect(result).toMatchObject({ matched: false, status: "not_started" });
    expect(runBrowserUseV3).not.toHaveBeenCalled();
  });

  it("never invokes V3 when semantic routing finds no match", async () => {
    registry.clearForTests();
    const runBrowserUseV3 = vi.fn();
    const result = await executeRoutedDeterministicCapability(
      { task: "Schedule a meeting tomorrow", requestingAgentId: "Agent 02" },
      { registry, runBrowserUseV3 },
    );
    expect(result.matched).toBe(false);
    expect(runBrowserUseV3).not.toHaveBeenCalled();
  });
});
