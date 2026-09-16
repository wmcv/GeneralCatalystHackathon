import { describe, expect, it, vi } from "vitest";
import type { LlmAdapter } from "../llm/types";
import { composeResult } from "./compose";

vi.mock("server-only", () => ({}));

describe("Replay result composition", () => {
  it("normalizes a concise comparison that omits sections", async () => {
    const adapter = {
      completeJson: async ({ schema }: { schema: { parse(value: unknown): unknown } }) => ({
        data: schema.parse({ title: "Top two", summary: "The first is broader; the second is simpler." }),
        usage: { model: "test", inputTokens: 10, outputTokens: 5, costUsd: 0, latencyMs: 1 },
      }),
    } as unknown as LlmAdapter;
    const result = await composeResult({ originalTask: "Compare the top two", remainingTask: "compare the top two", capabilityResult: [] }, adapter);
    expect(result.data.sections).toEqual([{ heading: "Top two", body: "The first is broader; the second is simpler." }]);
  });
});
