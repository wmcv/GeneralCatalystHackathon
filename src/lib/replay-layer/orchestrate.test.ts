import { describe, expect, it, vi } from "vitest";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import { createInMemoryRunStore } from "../state/run-store";
import type { DeterministicBrowserOutcome } from "../replay/deterministic-executor";
import { orchestrateReplayTask } from "./orchestrate";

vi.mock("server-only", () => ({}));

const outcome: DeterministicBrowserOutcome = {
  sessionId: "session-1", status: "stopped", isTaskSuccessful: true, elapsedMs: 900,
  totalInputTokens: 120, totalOutputTokens: 20, llmCostUsd: "0.01", browserCostUsd: "0.001",
  proxyCostUsd: "0", totalCostUsd: "0.011", messages: [{ type: "code_execution", summary: "Extracting results", data: "/workspace/scripts/task.py" }],
  scriptGenerated: true, rawResult: { links: [{ name: "Docs", url: "https://example.com" }] },
  structuredResult: { links: [{ name: "Docs", url: "https://example.com" }] }, validationError: null, error: null,
};

describe("dynamic learning orchestration", () => {
  it("publishes a successful novel capability immediately and separates trace actors and metrics", async () => {
    const registry = createInMemoryCapabilityRegistry();
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
    );
    expect(result.deterministicReady).toBe(true);
    expect(registry.listCapabilities()).toHaveLength(1);
    expect(registry.listCapabilities()[0].executionState).toBe("deterministic_ready");
    expect(new Set(result.trace.map((event) => event.actor))).toEqual(new Set(["user", "replay", "agent"]));
    expect(result.metrics).toMatchObject({ routing: { inputTokens: 50, outputTokens: 25 }, execution: { inputTokens: 120, outputTokens: 20 } });
  });
});
