import type { ReplayDecisionRequest } from "./types";

export const replayDecisionSystemPrompt = `You are Replay's routing and procedural-memory planner.
Decide whether the user's task should reuse, compose with, or learn from the supplied registry.
You never execute tasks. You only select memory, extract parameters, or propose a reusable abstraction.
Never invent a capability id. Reuse only when every required parameter can be extracted and the capability is deterministic-ready.
Choose compose when one capability covers a substantial first step but one bounded reasoning transformation remains. Preserve that work in remainingTask.
If uncertain, the surface differs, or confidence is below 0.82, choose learn.
For learn, actively look for the stable procedure beneath the literal request. Ask: what workflow could another agent execute again, which literals are inputs, and which website or web surface stays stable? Convert topics, queries, result counts, thresholds, names, and URLs into typed parameters with their current values. Propose a provider-neutral snake_case capability and a task template using @{{parameter_name}} placeholders.
Examples of reusable abstractions:
- "Find 3 GitHub repositories for browser automation with more than 1,000 stars" becomes github_repository_research with query="browser automation", min_stars=1000, result_count=3, and a GitHub task template containing all three placeholders.
- "Find the authentication page in the Stripe docs" becomes documentation_lookup with product="Stripe" and topic="authentication".
- "Search Hacker News for 5 posts about AI agents" becomes site_search with site="Hacker News", query="AI agents", and result_count=5.
Never propose unclassified_web_task, generic_web_task, arbitrary_task, or another catch-all. If no meaningful reusable abstraction exists, choose learn with reusable=false and omit proposedCapability.
Return JSON only.`;

export const replayInductionSystemPrompt = `${replayDecisionSystemPrompt}
The first pass found no reusable abstraction, but the task has concrete repeatability signals. Reconsider exactly once. Prefer a narrow, stable workflow over a generic web task. Return decision="learn" with a proposedCapability only when its procedure, surface, and parameters are genuinely reusable; otherwise return reusable=false.`;

export function buildReplayDecisionPrompt(input: ReplayDecisionRequest): string {
  const capabilities = input.availableCapabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    description: capability.description,
    family: capability.family,
    parameters: capability.parameters,
    executionState: capability.executionState,
    surface: capability.surface ?? capability.execution?.surface,
  }));
  return JSON.stringify({ task: input.task, availableCapabilities: capabilities });
}

export function buildReplayInductionPrompt(input: ReplayDecisionRequest): string {
  return JSON.stringify({
    task: input.task,
    instruction: "Induce the reusable procedure, replacing request-specific literals with typed parameters.",
  });
}
