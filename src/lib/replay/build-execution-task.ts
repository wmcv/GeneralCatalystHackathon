import type { SemanticCapability } from "../domain/capability";

export type CapabilityExecutionParameters = Record<string, string | number | boolean>;

export function buildCapabilityExecutionTask(
  capability: SemanticCapability,
  parameters: CapabilityExecutionParameters,
): string {
  const parameterLines = capability.parameters.map(
    (parameter) => `${parameter.name} = ${String(parameters[parameter.name])}`,
  );
  const strategyLines = capability.strategy.map(
    (stage, index) => `${index + 1}. ${stage.stage}\n   Objective: ${stage.objective}`,
  );
  const invariantLines = capability.invariants.map((invariant) => `- ${invariant}`);
  const fallbackLines = capability.fallbackTriggers.map((trigger) => `- ${trigger}`);

  return `Execute the known capability: ${capability.name}.

Parameters:
${parameterLines.join("\n")}

Follow this learned strategy:
${strategyLines.join("\n")}

Hard constraints:
${invariantLines.join("\n")}
- Do not exceed the maximum price.
- Prefer credible manufacturer, product, or review sources.
- Do not purchase anything, log in, or submit forms.
- Return exactly the requested number of products in the structured output.

Fallback triggers:
${fallbackLines.join("\n")}

Return JSON only with this shape:
{
  "summary": "string",
  "products": [
    { "name": "string", "price": "string", "url": "https://...", "whySuitable": "string" }
  ],
  "sources": [
    { "url": "https://...", "description": "string" }
  ],
  "limitations": ["string"]
}

This is execution of a known strategy.
Do not spend time inventing a new plan unless the strategy cannot complete the task.`;
}
