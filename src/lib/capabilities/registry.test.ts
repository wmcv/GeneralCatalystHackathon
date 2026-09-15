import { beforeEach, describe, expect, it } from "vitest";
import type { SemanticCapability } from "../domain/capability";
import { createInMemoryCapabilityRegistry } from "./registry";

const capability: SemanticCapability = {
  id: "capability-1",
  name: "comparative_product_research",
  description: "Compare products.",
  intentSignature: "comparative_product_research(product_type)",
  family: "comparative_product_research",
  version: 1,
  parameters: [],
  strategy: [],
  invariants: [],
  fallbackTriggers: [],
  learnedFromRunId: "run-1",
  learnedByAgentId: "Agent 01",
  scope: "organization",
  createdAt: "2026-09-15T15:11:47.648Z",
  successfulUses: 0,
  deterministicUses: 0,
  executionState: "semantic",
  sourceExample: { product_type: "mechanical keyboards" },
};

describe("capability registry", () => {
  const registry = createInMemoryCapabilityRegistry();

  beforeEach(() => registry.clearForTests());

  it("adds, lists, gets, and finds organization capabilities", () => {
    registry.addCapability(capability);
    expect(registry.listCapabilities()).toEqual([capability]);
    expect(registry.getCapabilityById(capability.id)).toEqual(capability);
    expect(registry.findByFamily(capability.family)).toEqual([capability]);
  });

  it("does not add a duplicate capability id and increments successful uses", () => {
    registry.addCapability(capability);
    registry.addCapability({ ...capability, description: "Duplicate" });
    expect(registry.listCapabilities()).toHaveLength(1);
    expect(registry.incrementSuccessfulUses(capability.id).successfulUses).toBe(1);
  });

  it("removes a capability from organization memory", () => {
    registry.addCapability(capability);
    expect(registry.removeCapability(capability.id)).toBe(true);
    expect(registry.getCapabilityById(capability.id)).toBeUndefined();
    expect(registry.listCapabilities()).toEqual([]);
  });

  it("records deterministic and successful usage together", () => {
    registry.addCapability(capability);
    const updated = registry.incrementDeterministicUses(
      capability.id,
      "2026-09-15T16:00:00.000Z",
    );
    expect(updated).toMatchObject({
      successfulUses: 1,
      deterministicUses: 1,
      lastUsedAt: "2026-09-15T16:00:00.000Z",
    });
  });

  it("marks deterministic readiness only after entering learning", () => {
    registry.addCapability(capability);
    expect(() => registry.markDeterministicReady(capability.id)).toThrow(
      "has no cached execution awaiting validation",
    );

    registry.beginDeterministicLearning(capability.id, {
      provider: "browser-use-v3",
      mode: "cached-script",
      workspaceId: "workspace-1",
      taskTemplate: "Research @{{product_type}}.",
      cacheScript: true,
      autoHeal: false,
    });
    expect(registry.markDeterministicReady(capability.id)).toMatchObject({
      executionState: "deterministic_ready",
      execution: { deterministicReady: true },
    });
    expect(registry.markDeterministicUnready(capability.id)).toMatchObject({
      executionState: "learning",
      execution: { workspaceId: "workspace-1", deterministicReady: false },
    });
  });
});
