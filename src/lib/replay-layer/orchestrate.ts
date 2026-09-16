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
import { browserMessageTrace, replayTrace } from "./trace";
import type { ProposedCapability, ReplayDecisionResult } from "./types";

export interface ReplayTaskResult {
  runId: string;
  prompt: string;
  agentId: string;
  decision: "reuse" | "learn";
  capability: SemanticCapability | null;
  deterministicReady: boolean;
  result: unknown;
  trace: TraceEvent[];
  metrics: {
    elapsedMs: number;
    routing: LlmUsage | null;
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
  },
): Promise<ReplayTaskResult> {
  const started = Date.now();
  const runId = randomUUID();
  const trace: TraceEvent[] = [
    replayTrace(runId, "user", "Prompt received", input.task),
    replayTrace(runId, "replay", "Interpreting task"),
    replayTrace(runId, "replay", "Searching collective memory"),
  ];
  const routing = await dependencies.decide(input.task, dependencies.registry.listCapabilities());

  if (routing.decision.decision === "reuse") {
    const capability = dependencies.registry.getCapabilityById(routing.decision.capabilityId!);
    trace.push(replayTrace(runId, "replay", "Capability found", capability?.name));
    trace.push(replayTrace(runId, "replay", "Extracted parameters", undefined, routing.decision.parameters));
    trace.push(replayTrace(runId, "executor", "Running learned procedure"));
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
      { registry: dependencies.registry, runStore: dependencies.runStore, runBrowserUseV3: dependencies.runBrowserUseV3 },
      routeDecision,
    );
    trace.push(...browserMessageTrace(runId, outcome));
    trace.push(replayTrace(runId, "replay", outcome.deterministicSuccess ? "Result validated" : "Learned procedure needs review", outcome.validationError ?? outcome.error ?? undefined));
    return {
      runId, prompt: input.task, agentId: input.agentId, decision: "reuse",
      capability: capability ?? null,
      deterministicReady: outcome.deterministicSuccess,
      result: outcome.structuredResult,
      trace,
      metrics: { elapsedMs: Date.now() - started, routing: routing.routing, execution: executionMetrics(outcome) },
      error: outcome.deterministicSuccess ? null : outcome.validationError ?? outcome.error ?? "Deterministic execution failed.",
    };
  }

  const proposal = routing.decision.proposedCapability!;
  trace.push(replayTrace(runId, "replay", "No reusable capability found"));
  trace.push(replayTrace(runId, "replay", "Proposing new capability", proposal.name));
  trace.push(replayTrace(runId, "agent", "Starting browser exploration"));
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
    },
    proposal.family === "github_repository_research"
      ? { taskTemplate: githubRepositoryResearchTaskTemplate, surface: { kind: "website", origin: "https://github.com" } }
      : { taskTemplate: proposal.taskTemplate, surface: proposal.surface },
  );
  if (learned.outcome) trace.push(...browserMessageTrace(runId, learned.outcome));
  trace.push(replayTrace(runId, "replay", "Validating successful execution"));
  trace.push(replayTrace(
    runId,
    "replay",
    learned.deterministicReady ? "Capability learned" : "Result returned without deterministic certification",
    learned.error ?? undefined,
  ));
  if (learned.deterministicReady) trace.push(replayTrace(runId, "replay", "Published to collective memory"));
  return {
    runId, prompt: input.task, agentId: input.agentId, decision: "learn",
    capability: learned.capability,
    deterministicReady: learned.deterministicReady,
    result: learned.outcome?.structuredResult ?? null,
    trace,
    metrics: { elapsedMs: Date.now() - started, routing: routing.routing, execution: executionMetrics(learned.outcome) },
    error: learned.outcome?.structuredResult ? null : learned.error,
  };
}
