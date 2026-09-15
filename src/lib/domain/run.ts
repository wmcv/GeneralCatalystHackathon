import { z } from "zod";

export const replayRunSchema = z.object({
  id: z.string().min(1),
  task: z.string().min(1),
  mode: z.enum(["discovery", "replay"]),
  status: z.enum(["idle", "running", "completed", "failed"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  browserUseRunId: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().optional(),
  totalInputTokens: z.number().int().nonnegative().optional(),
  totalOutputTokens: z.number().int().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  requestingAgentId: z.string().min(1).optional(),
  capabilityId: z.string().min(1).optional(),
  capabilityName: z.string().min(1).optional(),
  executionPhase: z.enum(["learning", "deterministic_reuse"]).optional(),
  llmCostUsd: z.number().nonnegative().optional(),
  browserCostUsd: z.number().nonnegative().optional(),
  proxyCostUsd: z.number().nonnegative().optional(),
});

export type ReplayRun = z.infer<typeof replayRunSchema>;
