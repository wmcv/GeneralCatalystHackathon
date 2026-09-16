import { z } from "zod";
import { openRouterAdapter } from "../llm/openrouter";
import type { JsonCompletion, LlmAdapter } from "../llm/types";

export const compositionOutputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sections: z.array(z.object({
    heading: z.string().min(1),
    body: z.string().min(1),
  })).min(1),
  recommendation: z.string().min(1).optional(),
});

export type CompositionOutput = z.infer<typeof compositionOutputSchema>;

export async function composeResult(
  input: { originalTask: string; remainingTask: string; capabilityResult: unknown },
  adapter: LlmAdapter = openRouterAdapter,
): Promise<JsonCompletion<CompositionOutput>> {
  return adapter.completeJson({
    schema: compositionOutputSchema,
    schemaName: "replay_composition",
    system: `You perform one bounded transformation over an existing structured result.
Do not browse, request new facts, or invent evidence. Complete only the remaining task.
Return concise JSON with a title, summary, comparison sections, and an optional recommendation.`,
    prompt: JSON.stringify({
      originalUserRequest: input.originalTask,
      remainingTask: input.remainingTask,
      structuredCapabilityOutput: input.capabilityResult,
    }),
  });
}
