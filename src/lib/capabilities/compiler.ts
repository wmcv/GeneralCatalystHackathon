import { browserUseSpikeResultSchema } from "../browser-use/types";
import {
  semanticCapabilitySchema,
  type SemanticCapability,
} from "../domain/capability";
import type { ReplayRun } from "../domain/run";
import { runStore, type RunStore } from "../state/run-store";

export class CapabilityCompilationError extends Error {}

export interface CompileCapabilityInput {
  runId: string;
  learnedByAgentId: string;
}

export function compileProductResearchCapability(
  run: ReplayRun,
  structuredResult: unknown,
  learnedByAgentId: string,
): SemanticCapability {
  if (run.mode !== "discovery" || run.status !== "completed") {
    throw new CapabilityCompilationError("Only completed discovery runs can be compiled.");
  }

  const result = browserUseSpikeResultSchema.safeParse(structuredResult);
  if (!result.success) {
    throw new CapabilityCompilationError("The discovery run has no validated structured result.");
  }

  return semanticCapabilitySchema.parse({
    id: `comparative-product-research:${run.id}`,
    name: "comparative_product_research",
    description: "Research and compare products under a price limit for a stated use case.",
    intentSignature:
      "comparative_product_research(product_type, max_price, currency, use_case, result_count)",
    family: "comparative_product_research",
    version: 1,
    parameters: [
      { name: "product_type", type: "string", required: true, description: "Product category to research." },
      { name: "max_price", type: "number", required: true, description: "Maximum unit price." },
      { name: "currency", type: "string", required: true, description: "Currency for the price constraint." },
      { name: "use_case", type: "string", required: true, description: "Intended use used to judge suitability." },
      { name: "result_count", type: "number", required: true, description: "Number of recommendations to return." },
    ],
    strategy: [
      {
        stage: "Discover candidates",
        objective: "Find plausible products matching the requested product category.",
        preferredEvidence: ["Current product listings"],
        completionCondition: "A candidate set exists for evidence gathering.",
      },
      {
        stage: "Gather evidence",
        objective: "Visit credible product/manufacturer/review sources and gather price and suitability evidence.",
        preferredEvidence: ["Manufacturer product pages", "Credible product reviews"],
        completionCondition: "Each candidate has price, suitability, and source evidence.",
      },
      {
        stage: "Enforce constraints",
        objective: "Remove candidates that violate hard constraints such as max price.",
        preferredEvidence: ["Current listed prices"],
        completionCondition: "Every remaining candidate satisfies the hard constraints.",
      },
      {
        stage: "Rank candidates",
        objective: "Compare remaining candidates against the stated use case.",
        preferredEvidence: ["Product specifications", "Use-case-relevant features"],
        completionCondition: "Candidates are ordered by suitability for the stated use case.",
      },
      {
        stage: "Return evidence-backed shortlist",
        objective: "Produce the requested number of candidates with source URLs and tradeoffs.",
        preferredEvidence: ["Direct source URLs"],
        completionCondition: "The shortlist contains the requested count with evidence and tradeoffs.",
      },
    ],
    invariants: [
      "Every recommendation satisfies the stated hard constraints.",
      "Every recommendation includes a source URL.",
      "Suitability claims are supported by gathered evidence.",
    ],
    fallbackTriggers: [
      "Too few candidates satisfy the hard constraints.",
      "Current price or suitability evidence cannot be verified.",
      "Sources conflict on a material product fact.",
    ],
    learnedFromRunId: run.id,
    learnedByAgentId,
    scope: "organization",
    createdAt: run.completedAt ?? new Date().toISOString(),
    successfulUses: 0,
    deterministicUses: 0,
    executionState: "semantic",
    sourceExample: {
      product_type: "mechanical keyboards",
      max_price: 180,
      currency: "USD",
      use_case: "programming",
      result_count: 3,
    },
  });
}

export function compileStoredDiscoveryRun(
  input: CompileCapabilityInput,
  store: RunStore = runStore,
): SemanticCapability {
  const run = store.get(input.runId);
  if (!run) throw new CapabilityCompilationError(`Unknown run ${input.runId}.`);

  const result = store.getResult(input.runId);
  return compileProductResearchCapability(run, result, input.learnedByAgentId);
}
