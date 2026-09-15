import { semanticCapabilitySchema, type SemanticCapability } from "../domain/capability";

export interface CapabilityRegistry {
  addCapability(capability: SemanticCapability): SemanticCapability;
  getCapabilityById(id: string): SemanticCapability | undefined;
  listCapabilities(): SemanticCapability[];
  findByFamily(family: string): SemanticCapability[];
  incrementSuccessfulUses(id: string): SemanticCapability;
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
    incrementSuccessfulUses(id) {
      const capability = capabilities.get(id);
      if (!capability) throw new Error(`Unknown capability ${id}.`);
      const updated = { ...capability, successfulUses: capability.successfulUses + 1 };
      capabilities.set(id, updated);
      return updated;
    },
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
