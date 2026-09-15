import type { BrowserUseSpikeResult } from "../browser-use/types";
import type { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityRouteDecision } from "../capabilities/router";
import { routeCapability } from "../capabilities/router";
import type { RunStore } from "../state/run-store";
import type { TraceEvent } from "../trace/types";
import { buildCapabilityExecutionTask } from "./build-execution-task";

export interface BrowserExecutionOutcome {
  runId: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  elapsedMs: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: string | null;
  rawResult: string | null;
  structuredResult: BrowserUseSpikeResult | null;
  validationError: string | null;
  error: string | null;
  liveViewUrl: string | null;
  traceEvents: TraceEvent[];
}

export interface ReplayExecutionResult extends BrowserExecutionOutcome {
  matched: boolean;
  routeDecision: CapabilityRouteDecision;
  requestingAgentId: string;
  capabilityId: string | null;
  capabilityName: string | null;
  executionTask: string | null;
}

export interface ExecuteCapabilityDependencies {
  registry: CapabilityRegistry;
  runStore: RunStore;
  runBrowserTask(task: string): Promise<BrowserExecutionOutcome>;
}

const emptyOutcome: BrowserExecutionOutcome = {
  runId: null,
  status: "not_started",
  createdAt: null,
  updatedAt: null,
  elapsedMs: 0,
  totalInputTokens: null,
  totalOutputTokens: null,
  totalCostUsd: null,
  rawResult: null,
  structuredResult: null,
  validationError: null,
  error: null,
  liveViewUrl: null,
  traceEvents: [],
};

export async function executeCapability(
  input: { task: string; requestingAgentId: string },
  dependencies: ExecuteCapabilityDependencies,
): Promise<ReplayExecutionResult> {
  const routeDecision = routeCapability(input.task, dependencies.registry);
  if (!routeDecision.matched || !routeDecision.capabilityId || !routeDecision.parameters) {
    return {
      ...emptyOutcome,
      matched: false,
      routeDecision,
      requestingAgentId: input.requestingAgentId,
      capabilityId: null,
      capabilityName: null,
      executionTask: null,
    };
  }

  const capability = dependencies.registry.getCapabilityById(routeDecision.capabilityId);
  if (!capability) {
    return {
      ...emptyOutcome,
      matched: false,
      routeDecision: { matched: false, reason: "The matched capability is no longer available." },
      requestingAgentId: input.requestingAgentId,
      capabilityId: null,
      capabilityName: null,
      executionTask: null,
    };
  }

  const executionTask = buildCapabilityExecutionTask(capability, routeDecision.parameters);
  const outcome = await dependencies.runBrowserTask(executionTask);
  const expectedCount = Number(routeDecision.parameters.result_count);
  const countMatches = outcome.structuredResult?.products.length === expectedCount;
  const validationError = outcome.validationError ?? (
    outcome.structuredResult && !countMatches
      ? `Expected ${expectedCount} products but received ${outcome.structuredResult.products.length}.`
      : null
  );
  const succeeded = outcome.status === "completed" && outcome.structuredResult !== null && !validationError;

  if (outcome.runId && outcome.createdAt) {
    dependencies.runStore.save({
      id: outcome.runId,
      task: input.task,
      mode: "replay",
      status: succeeded ? "completed" : "failed",
      startedAt: outcome.createdAt,
      ...(outcome.updatedAt ? { completedAt: outcome.updatedAt } : {}),
      browserUseRunId: outcome.runId,
      durationMs: outcome.elapsedMs,
      ...(outcome.totalInputTokens === null ? {} : { totalInputTokens: outcome.totalInputTokens }),
      ...(outcome.totalOutputTokens === null ? {} : { totalOutputTokens: outcome.totalOutputTokens }),
      ...(outcome.totalCostUsd === null ? {} : { totalCostUsd: Number(outcome.totalCostUsd) }),
      requestingAgentId: input.requestingAgentId,
      capabilityId: capability.id,
      capabilityName: capability.name,
    });
    if (succeeded) dependencies.runStore.saveResult(outcome.runId, outcome.structuredResult);
  }

  if (succeeded) dependencies.registry.incrementSuccessfulUses(capability.id);

  return {
    ...outcome,
    validationError,
    matched: true,
    routeDecision,
    requestingAgentId: input.requestingAgentId,
    capabilityId: capability.id,
    capabilityName: capability.name,
    executionTask,
  };
}
