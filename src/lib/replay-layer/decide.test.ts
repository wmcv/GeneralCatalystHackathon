import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { SemanticCapability } from "../domain/capability";
import type { LlmAdapter } from "../llm/types";
import { decideReplay } from "./decide";
import type { ReplayDecision } from "./types";

vi.mock("server-only", () => ({}));

function capability(overrides: Partial<SemanticCapability> = {}): SemanticCapability {
  return {
    id: "github-capability",
    name: "github_repository_research",
    description: "Find GitHub repositories.",
    intentSignature: "github_repository_research(query, min_stars, result_count)",
    family: "github_repository_research",
    version: 1,
    parameters: [
      { name: "query", type: "string", required: true, description: "Topic." },
      { name: "min_stars", type: "number", required: true, description: "Minimum stars." },
      { name: "result_count", type: "number", required: true, description: "Count." },
    ],
    strategy: [], invariants: [], fallbackTriggers: [], learnedFromRunId: "run-1",
    learnedByAgentId: "Agent 01", scope: "organization", createdAt: "2026-09-16T12:00:00.000Z",
    successfulUses: 2, deterministicUses: 2, executionState: "deterministic_ready",
    execution: { provider: "browser-use-v3", mode: "cached-script", workspaceId: "workspace-1", taskTemplate: "Find @{{result_count}} repos for @{{query}} over @{{min_stars}} stars", cacheScript: true, autoHeal: false, deterministicReady: true, surface: { kind: "website", origin: "https://github.com" } },
    sourceExample: { query: "automation", min_stars: 1000, result_count: 3 },
    ...overrides,
  };
}

function adapter(decision: ReplayDecision): LlmAdapter {
  return { completeJson: async () => ({ data: decision, usage: { model: "test", inputTokens: 40, outputTokens: 20, costUsd: 0.001, latencyMs: 10 } }) } as LlmAdapter;
}

const reuse: ReplayDecision = { decision: "reuse", reasoningSummary: "Strong match.", capabilityId: "github-capability", confidence: 0.96, parameters: { query: "agents", min_stars: 500, result_count: 4 } };

describe("Replay decision engine", () => {
  it("chooses only an existing capability and extracts parameters", async () => {
    const result = await decideReplay({ task: "Find four GitHub repositories for agents above 500 stars", availableCapabilities: [capability()] }, adapter(reuse));
    expect(result.decision).toMatchObject({ decision: "reuse", capabilityId: "github-capability", parameters: reuse.parameters });
  });

  it("composes GitHub discovery with a preserved follow-up task", async () => {
    const decision: ReplayDecision = {
      decision: "compose",
      reasoningSummary: "Discovery is known; comparison remains.",
      capabilityId: "github-capability",
      confidence: 0.97,
      parameters: { query: "workflow orchestration", min_stars: 1000, result_count: 3 },
      remainingTask: "Compare the top two returned repositories.",
    };
    const result = await decideReplay({
      task: "Find 3 GitHub repositories for workflow orchestration with over 1,000 stars, then compare the top two.",
      availableCapabilities: [capability()],
    }, adapter(decision));
    expect(result.decision).toMatchObject({
      decision: "compose",
      capabilityId: "github-capability",
      parameters: { query: "workflow orchestration", min_stars: 1000, result_count: 3 },
      remainingTask: "Compare the top two returned repositories.",
    });
  });

  it("does not accept an invented capability id", async () => {
    const result = await decideReplay({ task: "Research vendors", availableCapabilities: [capability()] }, adapter({ ...reuse, capabilityId: "invented" }));
    expect(result.decision.decision).toBe("learn");
  });

  it("returns learn for an unknown task", async () => {
    const result = await decideReplay({ task: "Look up deployment documentation", availableCapabilities: [] }, adapter({ decision: "learn", reasoningSummary: "Novel.", confidence: 0.9, proposedCapability: { name: "documentation_lookup", description: "Find product documentation.", family: "documentation_lookup", surface: { kind: "web" }, parameters: [{ name: "topic", type: "string", description: "Topic.", value: "deployment" }], taskTemplate: "Find documentation for @{{topic}}." } }));
    expect(result.decision).toMatchObject({ decision: "learn", proposedCapability: { name: "documentation_lookup" } });
  });

  it("fails safely when LLM output is malformed", async () => {
    const malformed = { completeJson: async () => { throw new Error("invalid JSON"); } } as LlmAdapter;
    const result = await decideReplay({ task: "Research an unfamiliar vendor", availableCapabilities: [] }, malformed);
    expect(result).toMatchObject({ fallbackUsed: true, decision: { decision: "learn" } });
  });

  it("falls back to composition for a known GitHub step plus a follow-up", async () => {
    const malformed = { completeJson: async () => { throw new Error("invalid JSON"); } } as LlmAdapter;
    const result = await decideReplay({
      task: "Find 3 GitHub repositories for workflow orchestration with over 1,000 stars, then compare the top two.",
      availableCapabilities: [capability()],
    }, malformed);
    expect(result.decision).toMatchObject({
      decision: "compose",
      capabilityId: "github-capability",
      parameters: { query: "workflow orchestration", min_stars: 1000, result_count: 3 },
      remainingTask: "compare the top two",
    });
  });

  it("falls back to learning for low confidence, non-ready memory, and surface mismatch", async () => {
    const low = await decideReplay({ task: "Find GitHub repositories for agents above 500 stars", availableCapabilities: [capability()] }, adapter({ ...reuse, confidence: 0.4 }));
    const notReady = capability({ executionState: "learning", execution: { ...capability().execution!, deterministicReady: false } });
    const pending = await decideReplay({ task: "Find GitHub repositories for agents above 500 stars", availableCapabilities: [notReady] }, adapter(reuse));
    const mismatch = await decideReplay({ task: "On gitlab.com find repositories for agents", availableCapabilities: [capability()] }, adapter(reuse));
    expect([low.decision.decision, pending.decision.decision, mismatch.decision.decision]).toEqual(["learn", "learn", "learn"]);
  });
});
