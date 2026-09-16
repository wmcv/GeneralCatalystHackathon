import { z } from "zod";

export const llmUsageSchema = z.object({
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  latencyMs: z.number().nonnegative(),
});

export interface JsonCompletion<T> {
  data: T;
  usage: z.infer<typeof llmUsageSchema>;
}

export interface JsonCompletionRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface LlmAdapter {
  completeJson<T>(request: JsonCompletionRequest<T>): Promise<JsonCompletion<T>>;
}

export type LlmUsage = z.infer<typeof llmUsageSchema>;
