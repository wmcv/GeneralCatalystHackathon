import { extractGitHubRepositoryResearchParameters, routeCapability } from "../capabilities/router";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import type { LlmAdapter } from "../llm/types";
import { openRouterAdapter } from "../llm/openrouter";
import { buildReplayDecisionPrompt, buildReplayInductionPrompt, replayDecisionSystemPrompt, replayInductionSystemPrompt } from "./prompts";
import {
  replayDecisionRequestSchema,
  replayDecisionResultSchema,
  replayDecisionSchema,
  type ReplayDecision,
  type ReplayDecisionRequest,
  type ReplayDecisionResult,
  type ProposedCapability,
} from "./types";

export const REUSE_CONFIDENCE_THRESHOLD = 0.82;
const FORBIDDEN_CAPABILITY_NAMES = new Set([
  "unclassified_web_task",
  "generic_web_task",
  "arbitrary_task",
]);

function githubComposition(input: ReplayDecisionRequest): ReplayDecision | null {
  const match = input.task.match(/^(.+?\bstars?)[,.]?\s*(?:then\s+)?(.+)$/i);
  if (!match) return null;
  const parameters = extractGitHubRepositoryResearchParameters(match[1]);
  const capability = input.availableCapabilities.find((item) =>
    item.family === "github_repository_research" &&
    item.executionState === "deterministic_ready" &&
    item.execution?.deterministicReady,
  );
  if (!parameters || !capability) return null;
  return {
    decision: "compose",
    capabilityId: capability.id,
    confidence: 0.96,
    parameters,
    remainingTask: match[2].trim().replace(/^then\s+/i, "").replace(/[.?!]+$/, ""),
    reasoningSummary: "Repository discovery is already known; only the follow-up transformation requires new reasoning.",
  };
}

export function isReusableCapabilityProposal(
  proposal: ReplayDecision["proposedCapability"],
): proposal is ProposedCapability {
  if (!proposal || FORBIDDEN_CAPABILITY_NAMES.has(proposal.name) || FORBIDDEN_CAPABILITY_NAMES.has(proposal.family)) return false;
  if (proposal.parameters.length === 0) return false;
  if (proposal.parameters.length === 1 && proposal.parameters[0].name === "task") return false;
  return Boolean(
    proposal.surface?.origin ||
    proposal.surface?.kind === "website" ||
    /@\{\{[a-z_][a-z0-9_]*\}\}/i.test(proposal.taskTemplate),
  );
}

function fallbackDecision(input: ReplayDecisionRequest): ReplayDecision {
  const composition = githubComposition(input);
  if (composition) return composition;
  const registry = createInMemoryCapabilityRegistry(new Map(
    input.availableCapabilities.map((capability) => [capability.id, capability]),
  ));
  const routed = routeCapability(input.task, registry);
  if (routed.matched && routed.capabilityId && routed.parameters) {
    return {
      decision: "reuse",
      reasoningSummary: "Matched the proven local capability router.",
      capabilityId: routed.capabilityId,
      confidence: routed.confidence ?? 0.9,
      parameters: routed.parameters,
    };
  }
  const github = extractGitHubRepositoryResearchParameters(input.task);
  if (github) {
    return {
      decision: "learn",
      reasoningSummary: "No reusable capability exists; using the proven GitHub learning fallback.",
      confidence: 0.95,
      proposedCapability: {
        name: "github_repository_research",
        description: "Find public GitHub repositories by topic and minimum star count.",
        family: "github_repository_research",
        surface: { kind: "website", origin: "https://github.com" },
        parameters: [
          { name: "query", type: "string", description: "Repository topic query.", value: github.query },
          { name: "min_stars", type: "number", description: "Minimum GitHub star count.", value: github.min_stars },
          { name: "result_count", type: "number", description: "Number of repositories.", value: github.result_count },
        ],
        taskTemplate: "On GitHub, find @{{result_count}} public repositories related to @{{query}} with at least @{{min_stars}} stars. Return name, owner, stars, GitHub URL, and description as JSON.",
      },
    };
  }
  return {
    decision: "learn",
    reasoningSummary: "No stable reusable abstraction was identified; run once without publishing memory.",
    confidence: 0,
    reusable: false,
  };
}

function mentionedOrigin(task: string): string | null {
  const url = task.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return new URL(url).origin;
  const host = task.match(/\b(?:www\.)?([a-z0-9-]+\.[a-z]{2,})\b/i)?.[0];
  return host ? `https://${host.replace(/^www\./, "")}` : null;
}

function safeDecision(input: ReplayDecisionRequest, proposed: ReplayDecision): ReplayDecision {
  if (proposed.decision === "learn") {
    return isReusableCapabilityProposal(proposed.proposedCapability)
      ? proposed
      : { decision: "learn", reasoningSummary: proposed.reasoningSummary, confidence: proposed.confidence, reusable: false };
  }
  const capability = input.availableCapabilities.find((item) => item.id === proposed.capabilityId);
  if (!capability || capability.executionState !== "deterministic_ready" || !capability.execution?.deterministicReady) {
    return fallbackDecision({ ...input, availableCapabilities: [] });
  }
  if (proposed.confidence < REUSE_CONFIDENCE_THRESHOLD) return fallbackDecision({ ...input, availableCapabilities: [] });
  if (capability.parameters.some((parameter) => parameter.required && proposed.parameters?.[parameter.name] === undefined)) {
    return fallbackDecision({ ...input, availableCapabilities: [] });
  }
  const requestedOrigin = mentionedOrigin(input.task);
  const learnedOrigin = capability.surface?.origin ?? capability.execution.surface?.origin;
  if (requestedOrigin && learnedOrigin && new URL(learnedOrigin).origin !== requestedOrigin) {
    return fallbackDecision({ ...input, availableCapabilities: [] });
  }
  return proposed;
}

export function hasStrongReusableSignals(task: string): boolean {
  const signals = [
    /https?:\/\/|\b(?:github|gitlab|linkedin|amazon|hacker news|documentation|docs|website|site)\b/i.test(task),
    /\b(?:find|return|list|get|show|search(?: for)?)\s+\d+\b/i.test(task),
    /\b(?:about|for|related to|matching|query|topic)\b/i.test(task),
    /(?:>|<|at least|more than|fewer than|under|over|minimum|maximum)\s*[\d,]+|[\d,]+\s*(?:stars?|results?|items?)/i.test(task),
  ];
  return signals.filter(Boolean).length >= 2;
}

export async function decideReplay(
  request: ReplayDecisionRequest,
  adapter: LlmAdapter = openRouterAdapter,
): Promise<ReplayDecisionResult> {
  const input = replayDecisionRequestSchema.parse(request);
  try {
    const completion = await adapter.completeJson({
      system: replayDecisionSystemPrompt,
      prompt: buildReplayDecisionPrompt(input),
      schema: replayDecisionSchema,
      schemaName: "replay_decision",
    });
    let decision = safeDecision(input, completion.data);
    let reconsideration: typeof completion.usage | null = null;
    if (decision.decision === "learn" && !isReusableCapabilityProposal(decision.proposedCapability) && hasStrongReusableSignals(input.task)) {
      try {
        const retry = await adapter.completeJson({
          system: replayInductionSystemPrompt,
          prompt: buildReplayInductionPrompt(input),
          schema: replayDecisionSchema,
          schemaName: "replay_induction_reconsideration",
        });
        reconsideration = retry.usage;
        decision = safeDecision(input, retry.data);
      } catch {
        // A failed bounded reconsideration leaves the safe first-pass decision unchanged.
      }
    }
    return replayDecisionResultSchema.parse({ decision, routing: completion.usage, reconsideration, fallbackUsed: false });
  } catch {
    return replayDecisionResultSchema.parse({
      decision: fallbackDecision(input),
      routing: null,
      reconsideration: null,
      fallbackUsed: true,
    });
  }
}
