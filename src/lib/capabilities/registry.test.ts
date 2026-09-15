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
});
