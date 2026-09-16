import { extractGitHubRepositoryResearchParameters, routeCapability } from "../capabilities/router";
import { createInMemoryCapabilityRegistry } from "../capabilities/registry";
import type { LlmAdapter } from "../llm/types";
import { openRouterAdapter } from "../llm/openrouter";
import { buildReplayDecisionPrompt, replayDecisionSystemPrompt } from "./prompts";
import {
  replayDecisionRequestSchema,
  replayDecisionResultSchema,
  replayDecisionSchema,
  type ReplayDecision,
  type ReplayDecisionRequest,
  type ReplayDecisionResult,
} from "./types";

export const REUSE_CONFIDENCE_THRESHOLD = 0.82;

function fallbackDecision(input: ReplayDecisionRequest): ReplayDecision {
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
    reasoningSummary: "Routing failed safely; an exploratory run is required.",
    confidence: 0,
    proposedCapability: {
      name: "unclassified_web_task",
      description: "A web task awaiting safe capability induction.",
      family: "unclassified_web_task",
      surface: { kind: "web" },
      parameters: [{ name: "task", type: "string", description: "The requested task.", value: input.task }],
      taskTemplate: "Complete this web task: @{{task}}. Return structured JSON.",
    },
  };
}

function mentionedOrigin(task: string): string | null {
  const url = task.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return new URL(url).origin;
  const host = task.match(/\b(?:www\.)?([a-z0-9-]+\.[a-z]{2,})\b/i)?.[0];
  return host ? `https://${host.replace(/^www\./, "")}` : null;
}

function safeDecision(input: ReplayDecisionRequest, proposed: ReplayDecision): ReplayDecision {
  if (proposed.decision === "learn") return proposed;
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
    const decision = safeDecision(input, completion.data);
    return replayDecisionResultSchema.parse({ decision, routing: completion.usage, fallbackUsed: false });
  } catch {
    return replayDecisionResultSchema.parse({
      decision: fallbackDecision(input),
      routing: null,
      fallbackUsed: true,
    });
  }
}
