import { replayRunSchema, type ReplayRun } from "@/lib/domain/run";

export interface RunStore {
  get(id: string): ReplayRun | undefined;
  list(): ReplayRun[];
  save(run: ReplayRun): ReplayRun;
}

export function createInMemoryRunStore(): RunStore {
  const runs = new Map<string, ReplayRun>();

  return {
    get: (id) => runs.get(id),
    list: () => Array.from(runs.values()),
    save(run) {
      const validatedRun = replayRunSchema.parse(run);
      runs.set(validatedRun.id, validatedRun);
      return validatedRun;
    },
  };
}

export const runStore = createInMemoryRunStore();
