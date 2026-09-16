import { randomUUID } from "node:crypto";
import type { CapabilityRegistry } from "../capabilities/registry";
import { capabilityRegistry } from "../capabilities/registry";
import type { SemanticCapability } from "../domain/capability";
import type { LlmUsage } from "../llm/types";
import { runDeterministicBrowserUseV3 } from "../browser-use/deterministic-runner";
import { githubRepositoryResearchTaskTemplate } from "../browser-use/capability-templates";
import { createDeterministicWorkspace, deleteDeterministicWorkspace } from "../browser-use/workspaces";
import type { DeterministicBrowserOutcome, DeterministicExecutionResult } from "../replay/deterministic-executor";
import { executeRoutedDeterministicCapability } from "../replay/deterministic-executor";
import { learnDeterministicCapability } from "../replay/learn-deterministic-capability";
import type { RunStore } from "../state/run-store";
import { runStore } from "../state/run-store";
import type { TraceEvent } from "../trace/types";
import { decideReplay } from "./decide";
import { isReusableCapabilityProposal } from "./decide";
import { composeResult, type CompositionOutput } from "./compose";
import { browserMessageEvent, browserMessageTrace, replayTrace } from "./trace";
import type { ProposedCapability, ReplayDecisionResult } from "./types";

export interface ReplayTaskResult {
  runId: string;
  prompt: string;
  agentId: string;
  decision: "reuse" | "compose" | "learn";
  capability: SemanticCapability | null;
  deterministicReady: boolean;
  result: unknown;
  trace: TraceEvent[];
  metrics: {
    elapsedMs: number;
    routing: LlmUsage | null;
    induction: LlmUsage | null;
    transformation: LlmUsage | null;
    execution: { inputTokens: number; outputTokens: number; llmCostUsd: number; browserCostUsd: number; totalCostUsd: number };
  };
  error: string | null;
}

export interface ReplayOrchestratorDependencies {
  registry: CapabilityRegistry;
  runStore: RunStore;
  decide(task: string, capabilities: SemanticCapability[]): Promise<ReplayDecisionResult>;
  runBrowserUseV3: typeof runDeterministicBrowserUseV3;
  createWorkspace: typeof createDeterministicWorkspace;
  deleteWorkspace: typeof deleteDeterministicWorkspace;
  postProcess?(input: {
    originalTask: string;
    remainingTask: string;
    capabilityResult: unknown;
  }): Promise<{ data: CompositionOutput; usage: LlmUsage }>;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function capabilityFromProposal(proposal: ProposedCapability, agentId: string, runId: string): SemanticCapability {
  const values = Object.fromEntries(proposal.parameters.map((parameter) => [parameter.name, parameter.value]));
  return {
    id: `${slug(proposal.family)}:${runId}`,
    name: proposal.name,
    description: proposal.description,
    intentSignature: `${proposal.name}(${proposal.parameters.map((parameter) => parameter.name).join(", ")})`,
    family: proposal.family,
    version: 1,
    parameters: proposal.parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      description: parameter.description,
      required: true,
    })),
    strategy: [{
      stage: "Execute task",
      objective: proposal.description,
      preferredEvidence: ["Live web evidence"],
      completionCondition: "A valid structured result is returned.",
    }],
    invariants: ["Return a valid result grounded in the requested web surface."],
    fallbackTriggers: ["The requested result cannot be validated."],
    learnedFromRunId: runId,
    learnedByAgentId: agentId,
    scope: "organization",
    createdAt: new Date().toISOString(),
    successfulUses: 0,
    deterministicUses: 0,
    surface: proposal.surface,
    executionState: "semantic",
    sourceExample: values,
  };
}

function executionMetrics(outcome: DeterministicBrowserOutcome | null) {
  return {
    inputTokens: outcome?.totalInputTokens ?? 0,
    outputTokens: outcome?.totalOutputTokens ?? 0,
    llmCostUsd: Number(outcome?.llmCostUsd ?? 0),
    browserCostUsd: Number(outcome?.browserCostUsd ?? 0),
    totalCostUsd: Number(outcome?.totalCostUsd ?? 0),
  };
}

export async function orchestrateReplayTask(
  input: { task: string; agentId: string },
  dependencies: ReplayOrchestratorDependencies = {
    registry: capabilityRegistry,
    runStore,
    decide: (task, capabilities) => decideReplay({ task, availableCapabilities: capabilities }),
    runBrowserUseV3: runDeterministicBrowserUseV3,
    createWorkspace: createDeterministicWorkspace,
    deleteWorkspace: deleteDeterministicWorkspace,
    postProcess: composeResult,
  },
  onTrace?: (event: TraceEvent) => void,
): Promise<ReplayTaskResult> {
  const started = Date.now();
  const runId = randomUUID();
  const trace: TraceEvent[] = [];
  const record = (...events: TraceEvent[]) => {
    for (const event of events) {
      const previous = trace.at(-1);
      if (previous?.actor === event.actor && previous.label === event.label && previous.detail === event.detail) continue;
      trace.push(event);
      onTrace?.(event);
    }
  };
  let streamedBrowserMessage = false;
  let browserActor: "agent" | "executor" = "agent";
  const onBrowserMessage = (message: { type: string; summary: string; data: string }) => {
    const event = browserMessageEvent(runId, message, browserActor);
    if (!event) return;
    streamedBrowserMessage = true;
    record(event);
  };
  record(
    replayTrace(runId, "user", "Prompt received", input.task),
    replayTrace(runId, "replay", "Interpreting task"),
    replayTrace(runId, "replay", "Checking collective memory…"),
  );
  const routing = await dependencies.decide(input.task, dependencies.registry.listCapabilities());

  if (routing.decision.decision === "reuse" || routing.decision.decision === "compose") {
    const composing = routing.decision.decision === "compose";
    browserActor = "executor";
    const capability = dependencies.registry.getCapabilityById(routing.decision.capabilityId!);
    record(replayTrace(runId, "replay", "✓ Known capability", capability?.name));
    if (composing) record(replayTrace(runId, "replay", "Existing capability covers repository discovery."));
    const parameterDetail = Object.entries(routing.decision.parameters ?? {})
      .map(([name, value]) => `${name} = ${String(value)}`)
      .join("\n");
    record(replayTrace(runId, "replay", "Extracted parameters", parameterDetail, routing.decision.parameters));
    record(replayTrace(runId, "executor", "Running learned procedure…"));
    const routeDecision = {
      matched: true,
      capabilityId: routing.decision.capabilityId,
      capabilityName: capability?.name,
      family: capability?.family,
      confidence: routing.decision.confidence,
      parameters: routing.decision.parameters,
      reason: routing.decision.reasoningSummary,
    };
    const outcome: DeterministicExecutionResult = await executeRoutedDeterministicCapability(
      { task: input.task, requestingAgentId: input.agentId },
      {
        registry: dependencies.registry,
        runStore: dependencies.runStore,
        runBrowserUseV3: (execution, task) => dependencies.runBrowserUseV3(execution, task, onBrowserMessage),
      },
      routeDecision,
    );
    if (!streamedBrowserMessage) record(...browserMessageTrace(runId, outcome, browserActor));
    let result: unknown = outcome.structuredResult;
    let transformation: LlmUsage | null = null;
    let compositionError: string | null = null;
    if (composing && outcome.deterministicSuccess && routing.decision.remainingTask) {
      record(replayTrace(runId, "replay", "Comparing the top two…", routing.decision.remainingTask));
      try {
        const completion = await (dependencies.postProcess ?? composeResult)({
          originalTask: input.task,
          remainingTask: routing.decision.remainingTask,
          capabilityResult: outcome.structuredResult,
        });
        transformation = completion.usage;
        result = { capabilityResult: outcome.structuredResult, transformation: completion.data };
        record(replayTrace(runId, "replay", "Complete."));
      } catch (error) {
        compositionError = error instanceof Error ? error.message : String(error);
        record(replayTrace(runId, "replay", "Comparison could not be completed", compositionError));
      }
    } else {
      record(replayTrace(
        runId,
        "replay",
        outcome.deterministicSuccess
          ? "Completed with 0 execution LLM tokens."
          : "Learned procedure needs review",
        outcome.validationError ?? outcome.error ?? undefined,
      ));
    }
    return {
      runId, prompt: input.task, agentId: input.agentId, decision: routing.decision.decision,
      capability: capability ?? null,
      deterministicReady: outcome.deterministicSuccess,
      result,
      trace,
      metrics: { elapsedMs: Date.now() - started, routing: routing.routing, induction: routing.reconsideration ?? null, transformation, execution: executionMetrics(outcome) },
      error: compositionError ?? (outcome.deterministicSuccess ? null : outcome.validationError ?? outcome.error ?? "Deterministic execution failed."),
    };
  }

  const proposal = routing.decision.proposedCapability;
  record(replayTrace(runId, "replay", "No matching capability found."));
  if (!isReusableCapabilityProposal(proposal)) {
    record(replayTrace(runId, "replay", "No reusable abstraction identified."));
    record(replayTrace(runId, "agent", "Starting one-time browser execution…"));
    const workspace = await dependencies.createWorkspace(`Replay one-time ${runId}`);
    let outcome: DeterministicBrowserOutcome | null = null;
    try {
      outcome = await dependencies.runBrowserUseV3({
        provider: "browser-use-v3",
        mode: "cached-script",
        workspaceId: workspace.id,
        taskTemplate: input.task,
        cacheScript: true,
        autoHeal: false,
        deterministicReady: false,
      }, input.task, onBrowserMessage);
    } finally {
      await dependencies.deleteWorkspace(workspace.id);
    }
    if (outcome && !streamedBrowserMessage) record(...browserMessageTrace(runId, outcome));
    record(replayTrace(runId, "replay", "Complete · not reusable."));
    return {
      runId, prompt: input.task, agentId: input.agentId, decision: "learn",
      capability: null, deterministicReady: false, result: outcome?.structuredResult ?? null, trace,
      metrics: { elapsedMs: Date.now() - started, routing: routing.routing, induction: routing.reconsideration ?? null, transformation: null, execution: executionMetrics(outcome) },
      error: outcome?.error ?? null,
    };
  }
  record(replayTrace(runId, "replay", "Reusable procedure identified.", proposal.name));
  record(replayTrace(runId, "replay", `Learning ${proposal.name}…`));
  record(replayTrace(runId, "agent", "Exploring task…"));
  const capability = dependencies.registry.addCapability(capabilityFromProposal(proposal, input.agentId, runId));
  const parameters = Object.fromEntries(proposal.parameters.map((parameter) => [parameter.name, parameter.value]));
  const learned = await learnDeterministicCapability(
    capability,
    parameters,
    {
      registry: dependencies.registry,
      runStore: dependencies.runStore,
      createWorkspace: dependencies.createWorkspace,
      deleteWorkspace: dependencies.deleteWorkspace,
      runBrowserUseV3: dependencies.runBrowserUseV3,
      onBrowserMessage,
    },
    proposal.family === "github_repository_research"
      ? { taskTemplate: githubRepositoryResearchTaskTemplate, surface: { kind: "website", origin: "https://github.com" } }
      : { taskTemplate: proposal.taskTemplate, surface: proposal.surface },
  );
  if (learned.outcome && !streamedBrowserMessage) record(...browserMessageTrace(runId, learned.outcome));
  record(replayTrace(runId, "replay", "Validating execution…"));
  record(replayTrace(
    runId,
    "replay",
    learned.deterministicReady ? "Capability learned" : "Result returned without deterministic certification",
    learned.error ?? undefined,
  ));
  if (learned.deterministicReady) record(replayTrace(runId, "replay", "Published to collective memory."));
  else dependencies.registry.removeCapability(capability.id);
  return {
    runId, prompt: input.task, agentId: input.agentId, decision: "learn",
    capability: learned.deterministicReady ? learned.capability : null,
    deterministicReady: learned.deterministicReady,
    result: learned.outcome?.structuredResult ?? null,
    trace,
    metrics: { elapsedMs: Date.now() - started, routing: routing.routing, induction: routing.reconsideration ?? null, transformation: null, execution: executionMetrics(learned.outcome) },
    error: learned.outcome?.structuredResult ? null : learned.error,
  };
}
