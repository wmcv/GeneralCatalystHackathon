import "server-only";

import { z } from "zod";
import type { JsonCompletion, JsonCompletionRequest, LlmAdapter } from "./types";

const configSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.union([z.string(), z.array(z.object({ text: z.string() }))]) }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  }).optional(),
});

export const openRouterConfig = {
  temperature: 0.1,
  maxTokens: 1_200,
} as const;

function config() {
  return configSchema.parse({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-5-mini",
  });
}

function contentText(content: string | Array<{ text: string }>): string {
  return typeof content === "string" ? content : content.map((part) => part.text).join("");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export const openRouterAdapter: LlmAdapter = {
  async completeJson<T>(request: JsonCompletionRequest<T>): Promise<JsonCompletion<T>> {
    const started = Date.now();
    const { apiKey, model } = config();
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://replay.local",
            "X-Title": "Replay",
          },
          body: JSON.stringify({
            model,
            temperature: openRouterConfig.temperature,
            max_tokens: openRouterConfig.maxTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.prompt },
            ],
          }),
        });
        if (!response.ok) throw new Error(`OpenRouter request failed with ${response.status}.`);
        const payload = responseSchema.parse(await response.json());
        const data = request.schema.parse(extractJson(contentText(payload.choices[0].message.content)));
        return {
          data,
          usage: {
            model: payload.model ?? model,
            inputTokens: payload.usage?.prompt_tokens ?? 0,
            outputTokens: payload.usage?.completion_tokens ?? 0,
            costUsd: payload.usage?.cost ?? null,
            latencyMs: Date.now() - started,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  },
};
