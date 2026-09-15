import { z } from "zod";

export const capabilityParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean(),
  description: z.string().min(1),
});

export const capabilityStageSchema = z.object({
  stage: z.string().min(1),
  objective: z.string().min(1),
  preferredEvidence: z.array(z.string().min(1)),
  completionCondition: z.string().min(1),
});

export const semanticCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  intentSignature: z.string().min(1),
  parameters: z.array(capabilityParameterSchema),
  strategy: z.array(capabilityStageSchema),
  invariants: z.array(z.string().min(1)),
  fallbackTriggers: z.array(z.string().min(1)),
  learnedFromRunId: z.string().min(1),
});

export type CapabilityParameter = z.infer<typeof capabilityParameterSchema>;
export type CapabilityStage = z.infer<typeof capabilityStageSchema>;
export type SemanticCapability = z.infer<typeof semanticCapabilitySchema>;
