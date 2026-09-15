import {
  semanticCapabilitySchema,
  type BrowserUseCachedScriptExecution,
  type SemanticCapability,
} from "../domain/capability";

type PendingExecution = Omit<BrowserUseCachedScriptExecution, "deterministicReady">;

export interface CapabilityRegistry {
  addCapability(capability: SemanticCapability): SemanticCapability;
  getCapabilityById(id: string): SemanticCapability | undefined;
  listCapabilities(): SemanticCapability[];
  findByFamily(family: string): SemanticCapability[];
  beginDeterministicLearning(id: string, execution: PendingExecution): SemanticCapability;
  markDeterministicReady(id: string): SemanticCapability;
  markDeterministicUnready(id: string): SemanticCapability;
  markDeterministicLearningFailed(id: string): SemanticCapability;
  incrementSuccessfulUses(id: string): SemanticCapability;
  incrementDeterministicUses(id: string, usedAt?: string): SemanticCapability;
  removeCapability(id: string): boolean;
  clearForTests(): void;
}

export function createInMemoryCapabilityRegistry(
  capabilities = new Map<string, SemanticCapability>(),
): CapabilityRegistry {
  return {
    addCapability(capability) {
      const validated = semanticCapabilitySchema.parse(capability);
      const existing = capabilities.get(validated.id);
      if (existing) return existing;
      capabilities.set(validated.id, validated);
      return validated;
    },
    getCapabilityById: (id) => capabilities.get(id),
    listCapabilities: () => Array.from(capabilities.values()),
    findByFamily: (family) =>
      Array.from(capabilities.values()).filter((capability) => capability.family === family),
    beginDeterministicLearning(id, execution) {
      const capability = capabilities.get(id);
      if (!capability) throw new Error(`Unknown capability ${id}.`);
      const updated = semanticCapabilitySchema.parse({
        ...capability,
        executionState: "learning",
        execution: { ...execution, deterministicReady: false },
      });
      capabilities.set(id, updated);
      return updated;
    },
    markDeterministicReady(id) {
      const capability = capabilities.get(id);
      if (!capability) throw new Error(`Unknown capability ${id}.`);
      if (capability.executionState !== "learning" || !capability.execution) {
        throw new Error(`Capability ${id} has no cached execution awaiting validation.`);
      }
      const updated = semanticCapabilitySchema.parse({
        ...capability,
        executionState: "deterministic_ready",
        execution: { ...capability.execution, deterministicReady: true },
      });
      capabilities.set(id, updated);
      return updated;
    },
    markDeterministicUnready(id) {
      const capability = capabilities.get(id);
      if (!capability?.execution) throw new Error(`Capability ${id} has no deterministic execution.`);
      const updated = semanticCapabilitySchema.parse({
        ...capability,
        executionState: "learning",
        execution: { ...capability.execution, deterministicReady: false },
      });
      capabilities.set(id, updated);
      return updated;
    },
    markDeterministicLearningFailed(id) {
      const capability = capabilities.get(id);
      if (!capability) throw new Error(`Unknown capability ${id}.`);
      const updated = semanticCapabilitySchema.parse({
        ...capability,
        execution: undefined,
        executionState: "semantic",
      });
      capabilities.set(id, updated);
      return updated;
    },
    incrementSuccessfulUses(id) {
      const capability = capabilities.get(id);
      if (!capability) throw new Error(`Unknown capability ${id}.`);
      const updated = { ...capability, successfulUses: capability.successfulUses + 1 };
      capabilities.set(id, updated);
      return updated;
    },
    incrementDeterministicUses(id, usedAt = new Date().toISOString()) {
      const capability = capabilities.get(id);
      if (!capability) throw new Error(`Unknown capability ${id}.`);
      const updated = semanticCapabilitySchema.parse({
        ...capability,
        successfulUses: capability.successfulUses + 1,
        deterministicUses: capability.deterministicUses + 1,
        lastUsedAt: usedAt,
      });
      capabilities.set(id, updated);
      return updated;
    },
    removeCapability: (id) => capabilities.delete(id),
    clearForTests() {
      capabilities.clear();
    },
  };
}

const globalCapabilityState = globalThis as typeof globalThis & {
  replayCapabilities?: Map<string, SemanticCapability>;
};

globalCapabilityState.replayCapabilities ??= new Map<string, SemanticCapability>();

export const capabilityRegistry = createInMemoryCapabilityRegistry(
  globalCapabilityState.replayCapabilities,
);
