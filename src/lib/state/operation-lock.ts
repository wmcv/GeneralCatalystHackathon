const globalOperationState = globalThis as typeof globalThis & {
  replayPendingOperations?: Set<string>;
};

globalOperationState.replayPendingOperations ??= new Set<string>();

const pendingOperations = globalOperationState.replayPendingOperations;

export function acquireOperation(key: string): boolean {
  if (pendingOperations.has(key)) return false;
  pendingOperations.add(key);
  return true;
}

export function releaseOperation(key: string): void {
  pendingOperations.delete(key);
}
