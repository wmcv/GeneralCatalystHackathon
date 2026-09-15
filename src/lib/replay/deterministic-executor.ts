import { browserUseSpikeResultSchema, type BrowserUseSpikeResult } from "../browser-use/types";
import type { CapabilityRegistry } from "../capabilities/registry";
import { routeCapability, type CapabilityRouteDecision } from "../capabilities/router";
import type {
  BrowserUseCachedScriptExecution,
  SemanticCapability,
} from "../domain/capability";

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
  rawResult: unknown;
  structuredResult: BrowserUseSpikeResult | null;
  validationError: string | null;
  error: string | null;
}

export interface DeterministicExecutionResult extends DeterministicBrowserOutcome {
  matched: boolean;
  routeDecision: CapabilityRouteDecision;
  capabilityId: string | null;
  capabilityName: string | null;
  requestingAgentId: string;
  executionTask: string | null;
}

export interface DeterministicExecutorDependencies {
  registry: CapabilityRegistry;
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
  rawResult: null,
  structuredResult: null,
  validationError: null,
  error: null,
};

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

  return execution.taskTemplate.replace(/@\{\{([a-z_][a-z0-9_]*)\}\}/gi, (_, name: string) => {
    const value = parameters[name];
    if (value === undefined) throw new Error(`Missing task-template parameter ${name}.`);
    return `@{{${String(value)}}}`;
  });
}

function rejected(
  input: { requestingAgentId: string },
  routeDecision: CapabilityRouteDecision,
  reason?: string,
): DeterministicExecutionResult {
  return {
    ...notStarted,
    matched: false,
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
  const succeeded = outcome.isTaskSuccessful === true && structuredResult.success && countMatches;
  const deterministicallySucceeded =
    succeeded &&
    outcome.totalInputTokens === 0 &&
    outcome.totalOutputTokens === 0 &&
    Number(outcome.llmCostUsd) === 0;

  if (deterministicallySucceeded) dependencies.registry.incrementDeterministicUses(capability.id);
  else if (succeeded) dependencies.registry.incrementSuccessfulUses(capability.id);

  return {
    ...outcome,
    matched: true,
    routeDecision,
    capabilityId: capability.id,
    capabilityName: capability.name,
    requestingAgentId: input.requestingAgentId,
    executionTask,
  };
}
