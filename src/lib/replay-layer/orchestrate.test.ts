import { describe, expect, it, vi } from "vitest";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import { createInMemoryRunStore } from "../state/run-store";
import type { DeterministicBrowserOutcome } from "../replay/deterministic-executor";
import type { TraceEvent } from "../trace/types";
import type { SemanticCapability } from "../domain/capability";
import { orchestrateReplayTask } from "./orchestrate";

vi.mock("server-only", () => ({}));

const outcome: DeterministicBrowserOutcome = {
  sessionId: "session-1", status: "stopped", isTaskSuccessful: true, elapsedMs: 900,
  totalInputTokens: 120, totalOutputTokens: 20, llmCostUsd: "0.01", browserCostUsd: "0.001",
  proxyCostUsd: "0", totalCostUsd: "0.011", messages: [{ type: "code_execution", summary: "Extracting results", data: "/workspace/scripts/task.py" }],
  scriptGenerated: true, rawResult: { links: [{ name: "Docs", url: "https://example.com" }] },
  structuredResult: { links: [{ name: "Docs", url: "https://example.com" }] }, validationError: null, error: null,
};

const githubCapability: SemanticCapability = {
  id: "github-capability", name: "github_repository_research", description: "Find GitHub repositories.",
  intentSignature: "github_repository_research(query, min_stars, result_count)", family: "github_repository_research", version: 1,
  parameters: [{ name: "query", type: "string", required: true, description: "Topic" }, { name: "min_stars", type: "number", required: true, description: "Stars" }, { name: "result_count", type: "number", required: true, description: "Count" }],
  strategy: [], invariants: [], fallbackTriggers: [], learnedFromRunId: "run-1", learnedByAgentId: "Agent 01", scope: "organization",
  createdAt: "2026-09-16T12:00:00.000Z", successfulUses: 0, deterministicUses: 0, executionState: "deterministic_ready",
  execution: { provider: "browser-use-v3", mode: "cached-script", workspaceId: "workspace-1", taskTemplate: "Find @{{result_count}} repos for @{{query}} over @{{min_stars}} stars", cacheScript: true, autoHeal: false, deterministicReady: true, surface: { kind: "website", origin: "https://github.com" } },
  sourceExample: { query: "automation", min_stars: 1000, result_count: 3 },
};

const githubOutcome: DeterministicBrowserOutcome = {
  ...outcome,
  totalInputTokens: 0, totalOutputTokens: 0, llmCostUsd: "0",
  structuredResult: { repositories: [
    { owner: "apache", name: "airflow", stars: 40000, url: "https://github.com/apache/airflow", description: "Workflows" },
    { owner: "labring", name: "FastGPT", stars: 25000, url: "https://github.com/labring/FastGPT", description: "AI workflows" },
    { owner: "dapr", name: "dapr", stars: 24000, url: "https://github.com/dapr/dapr", description: "Distributed runtime" },
  ] },
};

describe("dynamic learning orchestration", () => {
  it("publishes a successful novel capability immediately and separates trace actors and metrics", async () => {
    const registry = createInMemoryCapabilityRegistry();
    const streamedTrace: TraceEvent[] = [];
    const result = await orchestrateReplayTask(
      { task: "Find deployment documentation", agentId: "Agent 01" },
      {
        registry,
        runStore: createInMemoryRunStore(),
        decide: vi.fn().mockResolvedValue({ decision: { decision: "learn", reasoningSummary: "Novel.", confidence: 0.93, proposedCapability: { name: "documentation_lookup", description: "Find product documentation.", family: "documentation_lookup", surface: { kind: "web" }, parameters: [{ name: "topic", type: "string", description: "Documentation topic.", value: "deployment" }], taskTemplate: "Find documentation for @{{topic}} and return JSON." } }, routing: { model: "test", inputTokens: 50, outputTokens: 25, costUsd: 0.001, latencyMs: 10 }, fallbackUsed: false }),
        runBrowserUseV3: vi.fn().mockResolvedValue(outcome),
        createWorkspace: vi.fn().mockResolvedValue({ id: "workspace-1" }),
        deleteWorkspace: vi.fn(),
      },
      (event) => streamedTrace.push(event),
    );
    expect(result.deterministicReady).toBe(true);
    expect(registry.listCapabilities()).toHaveLength(1);
    expect(registry.listCapabilities()[0].executionState).toBe("deterministic_ready");
    expect(new Set(result.trace.map((event) => event.actor))).toEqual(new Set(["user", "replay", "agent"]));
    expect(streamedTrace).toEqual(result.trace);
    expect(result.trace.some((event) => event.actor === "executor" || event.label.includes("Running learned"))).toBe(false);
    expect(result.metrics).toMatchObject({ routing: { inputTokens: 50, outputTokens: 25 }, execution: { inputTokens: 120, outputTokens: 20 } });
  });

  it("executes one cached capability before one LLM transformation without a second browser run", async () => {
    const registry = createInMemoryCapabilityRegistry(new Map([[githubCapability.id, githubCapability]]));
    const runBrowserUseV3 = vi.fn().mockResolvedValue(githubOutcome);
    const postProcess = vi.fn().mockResolvedValue({
      data: { title: "Comparison", summary: "Two workflow projects.", sections: [{ heading: "Apache Airflow", body: "Best for scheduled data workflows." }, { heading: "FastGPT", body: "Best for AI knowledge workflows." }], recommendation: "Airflow for orchestration; FastGPT for AI applications." },
      usage: { model: "test", inputTokens: 120, outputTokens: 60, costUsd: 0.002, latencyMs: 12 },
    });
    const result = await orchestrateReplayTask(
      { task: "Find 3 GitHub repositories for workflow orchestration with over 1,000 stars, then compare the top two.", agentId: "Agent 02" },
      {
        registry, runStore: createInMemoryRunStore(),
        decide: vi.fn().mockResolvedValue({ decision: { decision: "compose", reasoningSummary: "Discovery known.", capabilityId: githubCapability.id, confidence: 0.98, parameters: { query: "workflow orchestration", min_stars: 1000, result_count: 3 }, remainingTask: "Compare the top two returned repositories." }, routing: { model: "test", inputTokens: 50, outputTokens: 20, costUsd: 0.001, latencyMs: 8 }, fallbackUsed: false }),
        runBrowserUseV3, postProcess,
        createWorkspace: vi.fn(), deleteWorkspace: vi.fn(),
      },
    );
    expect(runBrowserUseV3).toHaveBeenCalledOnce();
    expect(postProcess).toHaveBeenCalledOnce();
    expect(runBrowserUseV3.mock.invocationCallOrder[0]).toBeLessThan(postProcess.mock.invocationCallOrder[0]);
    expect(postProcess).toHaveBeenCalledWith({ originalTask: expect.any(String), remainingTask: "Compare the top two returned repositories.", capabilityResult: githubOutcome.structuredResult });
    expect(result).toMatchObject({ decision: "compose", metrics: { transformation: { inputTokens: 120, outputTokens: 60 } } });
    expect(result.trace).toContainEqual(expect.objectContaining({ actor: "executor", label: "Running learned procedure…" }));
  });

  it("does not publish a capability when learning fails readiness checks", async () => {
    const registry = createInMemoryCapabilityRegistry();
    const result = await orchestrateReplayTask(
      { task: "Find deployment documentation", agentId: "Agent 01" },
      {
        registry, runStore: createInMemoryRunStore(),
        decide: vi.fn().mockResolvedValue({ decision: { decision: "learn", reasoningSummary: "Reusable docs lookup.", confidence: 0.9, proposedCapability: { name: "documentation_lookup", description: "Find product documentation.", family: "documentation_lookup", surface: { kind: "web" }, parameters: [{ name: "topic", type: "string", description: "Topic.", value: "deployment" }], taskTemplate: "Find documentation for @{{topic}}." } }, routing: null, fallbackUsed: false }),
        runBrowserUseV3: vi.fn().mockResolvedValue({ ...outcome, scriptGenerated: false }),
        createWorkspace: vi.fn().mockResolvedValue({ id: "workspace-1" }), deleteWorkspace: vi.fn(),
      },
    );
    expect(result.deterministicReady).toBe(false);
    expect(result.capability).toBeNull();
    expect(registry.listCapabilities()).toEqual([]);
    expect(result.trace.some((event) => event.label === "Published to collective memory.")).toBe(false);
  });

  it("completes a non-reusable novel run without publishing a capability", async () => {
    const registry = createInMemoryCapabilityRegistry();
    const deleteWorkspace = vi.fn();
    const result = await orchestrateReplayTask(
      { task: "Do a one-off web task", agentId: "Agent 01" },
      {
        registry, runStore: createInMemoryRunStore(),
        decide: vi.fn().mockResolvedValue({ decision: { decision: "learn", reasoningSummary: "No stable abstraction.", confidence: 0.2, reusable: false }, routing: null, fallbackUsed: false }),
        runBrowserUseV3: vi.fn().mockResolvedValue(outcome), postProcess: vi.fn(),
        createWorkspace: vi.fn().mockResolvedValue({ id: "temporary-workspace" }), deleteWorkspace,
      },
    );
    expect(result.capability).toBeNull();
    expect(registry.listCapabilities()).toEqual([]);
    expect(deleteWorkspace).toHaveBeenCalledWith("temporary-workspace");
  });
});
