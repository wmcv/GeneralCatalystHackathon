import { browserUseSpikeResultSchema } from "../browser-use/types";
import {
  githubRepositoryResearchResultSchema,
  type GitHubRepositoryResearchResult,
} from "../browser-use/github-types";
import type { BrowserUseSpikeResult } from "../browser-use/types";
import type { SemanticCapability } from "../domain/capability";

export type CapabilityStructuredResult =
  | BrowserUseSpikeResult
  | GitHubRepositoryResearchResult
  | Record<string, unknown>
  | unknown[];

export function validateCapabilityResult(
  capability: SemanticCapability,
  parameters: Record<string, string | number | boolean>,
  value: unknown,
): { structuredResult: CapabilityStructuredResult | null; validationError: string | null } {
  if (capability.family === "github_repository_research") {
    const parsed = githubRepositoryResearchResultSchema.safeParse(value);
    if (!parsed.success) return { structuredResult: null, validationError: parsed.error.message };

    const expectedCount = Number(parameters.result_count);
    if (parsed.data.repositories.length !== expectedCount) {
      return {
        structuredResult: null,
        validationError: `Expected ${expectedCount} repositories but received ${parsed.data.repositories.length}.`,
      };
    }
    const minimumStars = Number(parameters.min_stars);
    const insufficient = parsed.data.repositories.find((repository) => repository.stars < minimumStars);
    if (insufficient) {
      return {
        structuredResult: null,
        validationError: `${insufficient.owner}/${insufficient.name} has ${insufficient.stars} stars; minimum is ${minimumStars}.`,
      };
    }
    return { structuredResult: parsed.data, validationError: null };
  }

  if (capability.family === "comparative_product_research") {
    const parsed = browserUseSpikeResultSchema.safeParse(value);
    if (!parsed.success) return { structuredResult: null, validationError: parsed.error.message };
    const expectedCount = Number(parameters.result_count);
    return parsed.data.products.length === expectedCount
      ? { structuredResult: parsed.data, validationError: null }
      : {
          structuredResult: null,
          validationError: `Expected ${expectedCount} products but received ${parsed.data.products.length}.`,
        };
  }

  if (Array.isArray(value)) {
    return value.length > 0
      ? { structuredResult: value, validationError: null }
      : { structuredResult: null, validationError: "The result list is empty." };
  }
  if (value && typeof value === "object" && Object.keys(value).length > 0) {
    return { structuredResult: value as Record<string, unknown>, validationError: null };
  }
  return { structuredResult: null, validationError: "The task returned no structured result." };
}
