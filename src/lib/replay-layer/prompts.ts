import type { ReplayDecisionRequest } from "./types";

export const replayDecisionSystemPrompt = `You are Replay's routing and procedural-memory planner.
Decide whether the user's task should reuse, compose with, or learn from the supplied registry.
You never execute tasks. You only select memory, extract parameters, or propose a reusable abstraction.
Never invent a capability id. Reuse only when every required parameter can be extracted and the capability is deterministic-ready.
Choose compose when one capability covers a substantial first step but one bounded reasoning transformation remains. Preserve that work in remainingTask.
If uncertain, the surface differs, or confidence is below 0.82, choose learn.
For learn, propose a provider-neutral snake_case capability, typed parameters with current values, and a parameterized task template using @{{parameter_name}} placeholders.
Never propose unclassified_web_task, generic_web_task, arbitrary_task, or another catch-all. If no meaningful reusable abstraction exists, choose learn with reusable=false and omit proposedCapability.
Return JSON only.`;

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
