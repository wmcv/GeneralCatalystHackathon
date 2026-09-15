import {
  comparativeProductResearchTaskTemplate,
  githubRepositoryResearchTaskTemplate,
} from "../browser-use/capability-templates";
import type { CapabilityRegistry } from "../capabilities/registry";
import { validateCapabilityResult } from "../capabilities/result-validation";
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

function deterministicDefinition(capability: SemanticCapability) {
  if (capability.family === "github_repository_research") {
    return {
      taskTemplate: githubRepositoryResearchTaskTemplate,
      surface: { kind: "website" as const, origin: "https://github.com" },
    };
  }
  if (capability.family === "comparative_product_research") {
    return { taskTemplate: comparativeProductResearchTaskTemplate };
  }
  throw new Error(`Capability family ${capability.family} has no deterministic template.`);
}

export async function learnDeterministicCapability(
  capability: SemanticCapability,
  sourceParameters: DeterministicParameters,
  dependencies: DeterministicLearningDependencies,
): Promise<DeterministicLearningResult> {
  if (capability.executionState !== "semantic" || capability.execution) {
    throw new Error(`Capability ${capability.id} is not awaiting deterministic learning.`);
  }
  const definition = deterministicDefinition(capability);

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
      taskTemplate: definition.taskTemplate,
      cacheScript: true,
      autoHeal: false,
      ...("surface" in definition ? { surface: definition.surface } : {}),
    });
    executionTask = renderParameterizedTaskTemplate(
      definition.taskTemplate,
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
      if (outcome.structuredResult) dependencies.runStore.saveResult(outcome.sessionId, outcome.structuredResult);
    }

    const validated = validateCapabilityResult(capability, sourceParameters, outcome.structuredResult);
    const valid =
      outcome.isTaskSuccessful === true &&
      outcome.validationError === null &&
      validated.validationError === null &&
      validated.structuredResult !== null;
    if (!valid || !outcome.scriptGenerated) {
      const reason = !valid
        ? outcome.validationError ?? validated.validationError ?? "Learning execution was invalid."
        : "Browser Use did not expose evidence that a reusable script was generated.";
      const reset = dependencies.registry.markDeterministicUnready(capability.id);
      return {
        capability: reset,
        executionTask,
        workspaceId,
        workspacePreserved: true,
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
      const stored = dependencies.registry.getCapabilityById(capability.id);
      if (stored?.execution) dependencies.registry.markDeterministicUnready(capability.id);
    }
    return {
      capability: dependencies.registry.getCapabilityById(capability.id) ?? capability,
      executionTask,
      workspaceId,
      workspacePreserved: workspaceId !== null,
      deterministicReady: false,
      outcome,
      error: errorMessage(error),
    };
  }
}

export async function confirmDeterministicLearning(
  capabilityId: string,
  sessionId: string,
  dependencies: Pick<DeterministicLearningDependencies, "registry" | "runStore"> & {
    getSessionMessages(
      sessionId: string,
    ): Promise<Array<{ type: string; summary: string; data: string }>>;
    containsGeneratedScript(
      messages: Array<{ type: string; summary: string; data: string }>,
    ): boolean;
  },
): Promise<SemanticCapability> {
  const capability = dependencies.registry.getCapabilityById(capabilityId);
  if (!capability?.execution || capability.executionState !== "learning") {
    throw new Error(`Capability ${capabilityId} is not awaiting learning confirmation.`);
  }
  const run = dependencies.runStore.get(sessionId);
  const result = dependencies.runStore.getResult(sessionId);
  if (!run || run.capabilityId !== capabilityId || run.executionPhase !== "learning") {
    throw new Error(`Session ${sessionId} is not a learning run for ${capabilityId}.`);
  }
  const validated = validateCapabilityResult(capability, capability.sourceExample, result);
  if (!validated.structuredResult || validated.validationError) {
    throw new Error(validated.validationError ?? "The stored learning result is invalid.");
  }
  const messages = await dependencies.getSessionMessages(sessionId);
  if (!dependencies.containsGeneratedScript(messages)) {
    throw new Error("Browser Use did not expose evidence that a reusable script was generated.");
  }
  dependencies.runStore.save({ ...run, status: "completed" });
  dependencies.runStore.saveResult(sessionId, validated.structuredResult);
  return dependencies.registry.markDeterministicReady(capabilityId);
}
