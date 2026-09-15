import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import type { SemanticCapability } from "../domain/capability";
import { createInMemoryRunStore } from "../state/run-store";
import type { DeterministicBrowserOutcome } from "./deterministic-executor";
import {
  confirmDeterministicLearning,
  learnDeterministicCapability,
} from "./learn-deterministic-capability";

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

const githubCapability: SemanticCapability = {
  ...semanticCapability,
  id: "github-capability-1",
  name: "github_repository_research",
  family: "github_repository_research",
  intentSignature: "github_repository_research(query, min_stars, result_count)",
  parameters: [
    { name: "query", type: "string", required: true, description: "Search topic." },
    { name: "min_stars", type: "number", required: true, description: "Minimum stars." },
    { name: "result_count", type: "number", required: true, description: "Count." },
  ],
  sourceExample: {
    query: "browser automation",
    min_stars: 1000,
    result_count: 3,
  },
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

  it("does not become ready and preserves the failed workspace for manual cleanup", async () => {
    const deleteWorkspace = vi.fn();
    const result = await learnDeterministicCapability(semanticCapability, sourceParameters, {
      registry,
      runStore,
      createWorkspace: vi.fn().mockResolvedValue({ id: "workspace-1" }),
      deleteWorkspace,
      runBrowserUseV3: vi.fn().mockResolvedValue({ ...outcome, scriptGenerated: false }),
    });

    expect(result).toMatchObject({ deterministicReady: false, workspacePreserved: true });
    expect(registry.getCapabilityById(semanticCapability.id)).toMatchObject({
      executionState: "learning",
      execution: { workspaceId: "workspace-1", deterministicReady: false },
    });
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it("binds GitHub learning to the GitHub website surface", async () => {
    registry.addCapability(githubCapability);
    const githubOutcome: DeterministicBrowserOutcome = {
      ...outcome,
      structuredResult: {
        repositories: Array.from({ length: 3 }, (_, index) => ({
          name: `repo-${index}`,
          owner: "owner",
          stars: 2000 + index,
          url: `https://github.com/owner/repo-${index}`,
          description: "Repository.",
        })),
      },
    };
    const runBrowserUseV3 = vi.fn().mockResolvedValue(githubOutcome);
    const result = await learnDeterministicCapability(
      githubCapability,
      { query: "browser automation", min_stars: 1000, result_count: 3 },
      {
        registry,
        runStore,
        createWorkspace: vi.fn().mockResolvedValue({ id: "github-workspace" }),
        deleteWorkspace: vi.fn(),
        runBrowserUseV3,
      },
    );
    expect(result.capability.execution).toMatchObject({
      surface: { kind: "website", origin: "https://github.com" },
      deterministicReady: true,
    });
    expect(runBrowserUseV3.mock.calls[0][1]).toContain(
      "find @{{3}} public repositories related to @{{browser automation}} with at least @{{1000}} stars",
    );
  });

  it("confirms a valid stored learning run after script evidence is observed", async () => {
    registry.addCapability(githubCapability);
    registry.beginDeterministicLearning(githubCapability.id, {
      provider: "browser-use-v3",
      mode: "cached-script",
      workspaceId: "github-workspace",
      taskTemplate: "Find @{{result_count}} GitHub repositories for @{{query}} above @{{min_stars}} stars.",
      cacheScript: true,
      autoHeal: false,
    });
    runStore.save({
      id: "github-session",
      task: "GitHub learning",
      mode: "discovery",
      status: "failed",
      startedAt: "2026-09-15T16:00:00.000Z",
      executionPhase: "learning",
      capabilityId: githubCapability.id,
    });
    runStore.saveResult("github-session", {
      repositories: Array.from({ length: 3 }, (_, index) => ({
        name: `repo-${index}`,
        owner: "owner",
        stars: 2000,
        url: `https://github.com/owner/repo-${index}`,
        description: "Repository.",
      })),
    });

    const confirmed = await confirmDeterministicLearning(
      githubCapability.id,
      "github-session",
      {
        registry,
        runStore,
        getSessionMessages: vi.fn().mockResolvedValue([{
          type: "code_execution",
          summary: "Run /workspace/scripts/github.py",
          data: "{}",
        }]),
        containsGeneratedScript: vi.fn().mockReturnValue(true),
      },
    );
    expect(confirmed.executionState).toBe("deterministic_ready");
    expect(runStore.get("github-session")?.status).toBe("completed");
  });
});
