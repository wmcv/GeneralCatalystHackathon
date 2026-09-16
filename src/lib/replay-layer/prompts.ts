import type { ReplayDecisionRequest } from "./types";

export const replayDecisionSystemPrompt = `You are Replay's routing and procedural-memory planner.
Decide whether the user's task can safely reuse exactly one capability from the supplied registry.
You never execute tasks. You only select memory, extract parameters, or propose a reusable abstraction.
Never invent a capability id. Reuse only when every required parameter can be extracted and the capability is deterministic-ready.
If uncertain, the surface differs, or confidence is below 0.82, choose learn.
For learn, propose a provider-neutral snake_case capability, typed parameters with current values, and a parameterized task template using @{{parameter_name}} placeholders.
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
