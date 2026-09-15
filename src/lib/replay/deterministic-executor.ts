import { browserUseSpikeResultSchema, type BrowserUseSpikeResult } from "../browser-use/types";
import type { CapabilityRegistry } from "../capabilities/registry";
import { routeCapability, type CapabilityRouteDecision } from "../capabilities/router";
import type {
  BrowserUseCachedScriptExecution,
  SemanticCapability,
} from "../domain/capability";
import type { RunStore } from "../state/run-store";

export type DeterministicParameters = Record<string, string | number | boolean>;

export interface DeterministicBrowserOutcome {
  sessionId: string | null;
  status: string;
  isTaskSuccessful: boolean | null;
  elapsedMs: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  llmCostUsd: string | null;
  browserCostUsd: string | null;
  proxyCostUsd: string | null;
  totalCostUsd: string | null;
  messages: Array<{ type: string; summary: string; data: string }>;
  scriptGenerated: boolean;
  rawResult: unknown;
  structuredResult: BrowserUseSpikeResult | null;
  validationError: string | null;
  error: string | null;
}

export interface DeterministicExecutionResult extends DeterministicBrowserOutcome {
  matched: boolean;
  deterministicSuccess: boolean;
  routeDecision: CapabilityRouteDecision;
  capabilityId: string | null;
  capabilityName: string | null;
  requestingAgentId: string;
  executionTask: string | null;
}

export interface DeterministicExecutorDependencies {
  registry: CapabilityRegistry;
  runStore?: RunStore;
  runBrowserUseV3(
    execution: BrowserUseCachedScriptExecution,
    task: string,
  ): Promise<DeterministicBrowserOutcome>;
}

const notStarted: DeterministicBrowserOutcome = {
  sessionId: null,
  status: "not_started",
  isTaskSuccessful: null,
  elapsedMs: 0,
  totalInputTokens: null,
  totalOutputTokens: null,
  llmCostUsd: null,
  browserCostUsd: null,
  proxyCostUsd: null,
  totalCostUsd: null,
  messages: [],
  scriptGenerated: false,
  rawResult: null,
  structuredResult: null,
  validationError: null,
  error: null,
};

export function renderParameterizedTaskTemplate(
  taskTemplate: string,
  parameters: DeterministicParameters,
): string {
  return taskTemplate.replace(/@\{\{([a-z_][a-z0-9_]*)\}\}/gi, (_, name: string) => {
    const value = parameters[name];
    if (value === undefined) throw new Error(`Missing task-template parameter ${name}.`);
    return `@{{${String(value)}}}`;
  });
}

export function renderCachedScriptTask(
  capability: SemanticCapability,
  parameters: DeterministicParameters,
): string {
  const execution = capability.execution;
  if (!execution || !execution.deterministicReady || capability.executionState !== "deterministic_ready") {
    throw new Error(`Capability ${capability.id} is not deterministic-ready.`);
  }

  for (const parameter of capability.parameters.filter((item) => item.required)) {
    if (parameters[parameter.name] === undefined) {
      throw new Error(`Missing required capability parameter ${parameter.name}.`);
    }
  }

  return renderParameterizedTaskTemplate(execution.taskTemplate, parameters);
}

function rejected(
  input: { requestingAgentId: string },
  routeDecision: CapabilityRouteDecision,
  reason?: string,
): DeterministicExecutionResult {
  return {
    ...notStarted,
    matched: false,
    deterministicSuccess: false,
    routeDecision: reason ? { matched: false, reason } : routeDecision,
    capabilityId: null,
    capabilityName: null,
    requestingAgentId: input.requestingAgentId,
    executionTask: null,
  };
}

export async function executeRoutedDeterministicCapability(
  input: { task: string; requestingAgentId: string },
  dependencies: DeterministicExecutorDependencies,
): Promise<DeterministicExecutionResult> {
  const routeDecision = routeCapability(input.task, dependencies.registry);
  if (!routeDecision.matched || !routeDecision.capabilityId || !routeDecision.parameters) {
    return rejected(input, routeDecision);
  }

  const capability = dependencies.registry.getCapabilityById(routeDecision.capabilityId);
  if (!capability) return rejected(input, routeDecision, "The matched capability is unavailable.");
  if (!capability.execution?.deterministicReady || capability.executionState !== "deterministic_ready") {
    return rejected(input, routeDecision, "The matched capability is not deterministic-ready.");
  }

  const executionTask = renderCachedScriptTask(capability, routeDecision.parameters);
  const outcome = await dependencies.runBrowserUseV3(capability.execution, executionTask);
  const structuredResult = browserUseSpikeResultSchema.safeParse(outcome.structuredResult);
  const expectedCount = Number(routeDecision.parameters.result_count);
  const countMatches = structuredResult.success && structuredResult.data.products.length === expectedCount;
  const validationError = outcome.validationError ?? (
    structuredResult.success && !countMatches
      ? `Expected ${expectedCount} products but received ${structuredResult.data.products.length}.`
      : null
  );
  const succeeded =
    outcome.status === "stopped" &&
    outcome.isTaskSuccessful !== false &&
    outcome.error === null &&
    structuredResult.success &&
    countMatches &&
    validationError === null;
  const deterministicallySucceeded =
    succeeded &&
    outcome.totalInputTokens === 0 &&
    outcome.totalOutputTokens === 0 &&
    Number(outcome.llmCostUsd) === 0;

  if (deterministicallySucceeded) dependencies.registry.incrementDeterministicUses(capability.id);
  else if (succeeded) dependencies.registry.incrementSuccessfulUses(capability.id);
  else dependencies.registry.markDeterministicUnready(capability.id);

  if (dependencies.runStore && outcome.sessionId) {
    const completedAt = new Date();
    dependencies.runStore.save({
      id: outcome.sessionId,
      task: input.task,
      mode: "replay",
      status: succeeded ? "completed" : "failed",
      startedAt: new Date(completedAt.getTime() - outcome.elapsedMs).toISOString(),
      completedAt: completedAt.toISOString(),
      browserUseRunId: outcome.sessionId,
      durationMs: outcome.elapsedMs,
      ...(outcome.totalInputTokens === null ? {} : { totalInputTokens: outcome.totalInputTokens }),
      ...(outcome.totalOutputTokens === null ? {} : { totalOutputTokens: outcome.totalOutputTokens }),
      ...(outcome.totalCostUsd === null ? {} : { totalCostUsd: Number(outcome.totalCostUsd) }),
      requestingAgentId: input.requestingAgentId,
      capabilityId: capability.id,
      capabilityName: capability.name,
      executionPhase: "deterministic_reuse",
      ...(outcome.llmCostUsd === null ? {} : { llmCostUsd: Number(outcome.llmCostUsd) }),
      ...(outcome.browserCostUsd === null ? {} : { browserCostUsd: Number(outcome.browserCostUsd) }),
      ...(outcome.proxyCostUsd === null ? {} : { proxyCostUsd: Number(outcome.proxyCostUsd) }),
    });
    if (succeeded) dependencies.runStore.saveResult(outcome.sessionId, outcome.structuredResult);
  }

  return {
    ...outcome,
    validationError,
    matched: true,
    deterministicSuccess: deterministicallySucceeded,
    routeDecision,
    capabilityId: capability.id,
    capabilityName: capability.name,
    requestingAgentId: input.requestingAgentId,
    executionTask,
  };
}
