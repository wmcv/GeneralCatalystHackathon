import { z } from "zod";

export const traceEventCategorySchema = z.enum([
  "lifecycle",
  "browser",
  "reasoning",
  "search",
  "state",
  "result",
]);

export const traceActorSchema = z.enum(["user", "replay", "agent", "executor"]);

export const traceEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: traceActorSchema,
  category: traceEventCategorySchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().optional(),
  isAi: z.boolean(),
  rawEventType: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TraceEvent = z.infer<typeof traceEventSchema>;
export type TraceActor = z.infer<typeof traceActorSchema>;
