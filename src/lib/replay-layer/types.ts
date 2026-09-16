import { z } from "zod";
import { capabilityParameterSchema, semanticCapabilitySchema } from "../domain/capability";
import { llmUsageSchema } from "../llm/types";

const valueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const proposedCapabilitySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  family: z.string().regex(/^[a-z][a-z0-9_]*$/),
  surface: z.object({
    kind: z.enum(["website", "web"]),
    origin: z.url().optional(),
  }).optional(),
  parameters: z.array(capabilityParameterSchema.omit({ required: true }).extend({ value: valueSchema })),
  taskTemplate: z.string().min(1),
});

export const replayDecisionSchema = z.object({
  decision: z.enum(["reuse", "learn"]),
  reasoningSummary: z.string().min(1),
  capabilityId: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  parameters: z.record(z.string(), valueSchema).optional(),
  proposedCapability: proposedCapabilitySchema.optional(),
}).superRefine((decision, context) => {
  if (decision.decision === "reuse" && (!decision.capabilityId || !decision.parameters)) {
    context.addIssue({ code: "custom", message: "Reuse requires a capability and parameters." });
  }
  if (decision.decision === "learn" && !decision.proposedCapability) {
    context.addIssue({ code: "custom", message: "Learning requires a proposed capability." });
  }
});

export const replayDecisionRequestSchema = z.object({
  task: z.string().trim().min(1),
  availableCapabilities: z.array(semanticCapabilitySchema),
});

export const replayDecisionResultSchema = z.object({
  decision: replayDecisionSchema,
  routing: llmUsageSchema.nullable(),
  fallbackUsed: z.boolean(),
});

export type ReplayDecision = z.infer<typeof replayDecisionSchema>;
export type ReplayDecisionRequest = z.infer<typeof replayDecisionRequestSchema>;
export type ReplayDecisionResult = z.infer<typeof replayDecisionResultSchema>;
export type ProposedCapability = z.infer<typeof proposedCapabilitySchema>;
