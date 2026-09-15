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

export const browserUseCachedScriptExecutionSchema = z.object({
  provider: z.literal("browser-use-v3"),
  mode: z.literal("cached-script"),
  workspaceId: z.string().min(1),
  taskTemplate: z.string().min(1),
  cacheScript: z.literal(true),
  autoHeal: z.literal(false),
  deterministicReady: z.boolean(),
});

export const capabilityExecutionStateSchema = z.enum([
  "semantic",
  "learning",
  "deterministic_ready",
]);

export const semanticCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  intentSignature: z.string().min(1),
  family: z.string().min(1),
  version: z.number().int().positive(),
  parameters: z.array(capabilityParameterSchema),
  strategy: z.array(capabilityStageSchema),
  invariants: z.array(z.string().min(1)),
  fallbackTriggers: z.array(z.string().min(1)),
  learnedFromRunId: z.string().min(1),
  learnedByAgentId: z.string().min(1),
  scope: z.literal("organization"),
  createdAt: z.string().datetime(),
  successfulUses: z.number().int().nonnegative(),
  deterministicUses: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().optional(),
  executionState: capabilityExecutionStateSchema,
  execution: browserUseCachedScriptExecutionSchema.optional(),
  sourceExample: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
}).superRefine((capability, context) => {
  const descriptorReady = capability.execution?.deterministicReady === true;
  const stateReady = capability.executionState === "deterministic_ready";
  if (descriptorReady !== stateReady) {
    context.addIssue({
      code: "custom",
      path: ["executionState"],
      message: "Deterministic-ready state must agree with the execution descriptor.",
    });
  }
});

export type CapabilityParameter = z.infer<typeof capabilityParameterSchema>;
export type CapabilityStage = z.infer<typeof capabilityStageSchema>;
export type BrowserUseCachedScriptExecution = z.infer<
  typeof browserUseCachedScriptExecutionSchema
>;
export type CapabilityExecutionState = z.infer<typeof capabilityExecutionStateSchema>;
export type SemanticCapability = z.infer<typeof semanticCapabilitySchema>;
