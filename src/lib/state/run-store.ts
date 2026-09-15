import { replayRunSchema, type ReplayRun } from "../domain/run";

export interface RunStore {
  get(id: string): ReplayRun | undefined;
  getResult(id: string): unknown | undefined;
  list(): ReplayRun[];
  save(run: ReplayRun): ReplayRun;
  saveResult(id: string, result: unknown): void;
  removeByCapabilityId(capabilityId: string): number;
  clearForTests(): void;
}

export function createInMemoryRunStore(
  runs = new Map<string, ReplayRun>(),
  results = new Map<string, unknown>(),
): RunStore {

  return {
    get: (id) => runs.get(id),
    getResult: (id) => results.get(id),
    list: () => Array.from(runs.values()),
    save(run) {
      const validatedRun = replayRunSchema.parse(run);
      runs.set(validatedRun.id, validatedRun);
      return validatedRun;
    },
    saveResult(id, result) {
      if (!runs.has(id)) throw new Error(`Cannot save a result for unknown run ${id}.`);
      results.set(id, result);
    },
    removeByCapabilityId(capabilityId) {
      const matchingIds = Array.from(runs.values())
        .filter((run) => run.capabilityId === capabilityId)
        .map((run) => run.id);
      for (const id of matchingIds) {
        runs.delete(id);
        results.delete(id);
      }
      return matchingIds.length;
    },
    clearForTests() {
      runs.clear();
      results.clear();
    },
  };
}

const globalRunState = globalThis as typeof globalThis & {
  replayRuns?: Map<string, ReplayRun>;
  replayRunResults?: Map<string, unknown>;
};

globalRunState.replayRuns ??= new Map<string, ReplayRun>();
globalRunState.replayRunResults ??= new Map<string, unknown>();

export const runStore = createInMemoryRunStore(
  globalRunState.replayRuns,
  globalRunState.replayRunResults,
);
