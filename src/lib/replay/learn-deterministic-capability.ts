import { comparativeProductResearchTaskTemplate } from "../browser-use/capability-templates";
import type { CapabilityRegistry } from "../capabilities/registry";
import type { SemanticCapability } from "../domain/capability";
import type { RunStore } from "../state/run-store";
import {
  renderParameterizedTaskTemplate,
  type DeterministicBrowserOutcome,
  type DeterministicParameters,
} from "./deterministic-executor";

export interface DeterministicLearningDependencies {
  registry: CapabilityRegistry;
  runStore: RunStore;
  createWorkspace(name: string): Promise<{ id: string }>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  runBrowserUseV3(
    execution: NonNullable<SemanticCapability["execution"]>,
    task: string,
  ): Promise<DeterministicBrowserOutcome>;
}

export interface DeterministicLearningResult {
  capability: SemanticCapability;
  executionTask: string | null;
  workspaceId: string | null;
  workspacePreserved: boolean;
  deterministicReady: boolean;
  outcome: DeterministicBrowserOutcome | null;
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function numberOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function learnDeterministicCapability(
  capability: SemanticCapability,
  sourceParameters: DeterministicParameters,
  dependencies: DeterministicLearningDependencies,
): Promise<DeterministicLearningResult> {
  if (capability.executionState !== "semantic" || capability.execution) {
    throw new Error(`Capability ${capability.id} is not awaiting deterministic learning.`);
  }
  if (capability.family !== "comparative_product_research") {
    throw new Error(`Capability family ${capability.family} has no deterministic template.`);
  }

  let workspaceId: string | null = null;
  let executionTask: string | null = null;
  let outcome: DeterministicBrowserOutcome | null = null;

  try {
    const workspace = await dependencies.createWorkspace(
      `Replay ${capability.name} ${capability.id}`,
    );
    workspaceId = workspace.id;
    const learning = dependencies.registry.beginDeterministicLearning(capability.id, {
      provider: "browser-use-v3",
      mode: "cached-script",
      workspaceId,
      taskTemplate: comparativeProductResearchTaskTemplate,
      cacheScript: true,
      autoHeal: false,
    });
    executionTask = renderParameterizedTaskTemplate(
      comparativeProductResearchTaskTemplate,
      sourceParameters,
    );
    outcome = await dependencies.runBrowserUseV3(learning.execution!, executionTask);

    if (outcome.sessionId) {
      dependencies.runStore.save({
        id: outcome.sessionId,
        task: executionTask,
        mode: "discovery",
        status: outcome.isTaskSuccessful ? "completed" : "failed",
        startedAt: new Date(Date.now() - outcome.elapsedMs).toISOString(),
        completedAt: new Date().toISOString(),
        browserUseRunId: outcome.sessionId,
        durationMs: outcome.elapsedMs,
        ...(outcome.totalInputTokens === null ? {} : { totalInputTokens: outcome.totalInputTokens }),
        ...(outcome.totalOutputTokens === null ? {} : { totalOutputTokens: outcome.totalOutputTokens }),
        ...(numberOrUndefined(outcome.totalCostUsd) === undefined ? {} : { totalCostUsd: numberOrUndefined(outcome.totalCostUsd) }),
        requestingAgentId: capability.learnedByAgentId,
        capabilityId: capability.id,
        capabilityName: capability.name,
        executionPhase: "learning",
        ...(numberOrUndefined(outcome.llmCostUsd) === undefined ? {} : { llmCostUsd: numberOrUndefined(outcome.llmCostUsd) }),
        ...(numberOrUndefined(outcome.browserCostUsd) === undefined ? {} : { browserCostUsd: numberOrUndefined(outcome.browserCostUsd) }),
        ...(numberOrUndefined(outcome.proxyCostUsd) === undefined ? {} : { proxyCostUsd: numberOrUndefined(outcome.proxyCostUsd) }),
      });
      if (outcome.structuredResult) {
        dependencies.runStore.saveResult(outcome.sessionId, outcome.structuredResult);
      }
    }

    const expectedCount = Number(sourceParameters.result_count);
    const valid =
      outcome.isTaskSuccessful === true &&
      outcome.validationError === null &&
      outcome.structuredResult?.products.length === expectedCount;
    if (!valid || !outcome.scriptGenerated) {
      const reason = !valid
        ? outcome.validationError ?? "Learning execution did not return the requested product count."
        : "Browser Use did not expose evidence that a reusable script was generated.";
      await dependencies.deleteWorkspace(workspaceId);
      const reset = dependencies.registry.markDeterministicLearningFailed(capability.id);
      return {
        capability: reset,
        executionTask,
        workspaceId,
        workspacePreserved: false,
        deterministicReady: false,
        outcome,
        error: outcome.error ?? reason,
      };
    }

    const ready = dependencies.registry.markDeterministicReady(capability.id);
    return {
      capability: ready,
      executionTask,
      workspaceId,
      workspacePreserved: true,
      deterministicReady: true,
      outcome,
      error: null,
    };
  } catch (error) {
    if (workspaceId) {
      try {
        await dependencies.deleteWorkspace(workspaceId);
      } catch {
        // Preserve the original learning failure.
      }
      dependencies.registry.markDeterministicLearningFailed(capability.id);
    }
    return {
      capability: dependencies.registry.getCapabilityById(capability.id) ?? capability,
      executionTask,
      workspaceId,
      workspacePreserved: false,
      deterministicReady: false,
      outcome,
      error: errorMessage(error),
    };
  }
}
