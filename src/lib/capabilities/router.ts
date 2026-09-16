import { z } from "zod";
import type { CapabilityRegistry } from "./registry";
import { capabilityRegistry } from "./registry";

const routeParameterSchema = z.union([z.string(), z.number(), z.boolean()]);

export const capabilityRouteDecisionSchema = z.object({
  matched: z.boolean(),
  capabilityId: z.string().optional(),
  capabilityName: z.string().optional(),
  family: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  parameters: z.record(z.string(), routeParameterSchema).optional(),
  reason: z.string().min(1),
});

export type CapabilityRouteDecision = z.infer<typeof capabilityRouteDecisionSchema>;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

function noMatch(reason: string): CapabilityRouteDecision {
  return capabilityRouteDecisionSchema.parse({ matched: false, reason });
}

function parseCount(value: string | undefined): number {
  if (!value) return 3;
  return NUMBER_WORDS[value.toLowerCase()] ?? Number(value);
}

export interface GitHubRepositoryResearchParameters extends Record<string, string | number | boolean> {
  query: string;
  min_stars: number;
  result_count: number;
}

export function extractGitHubRepositoryResearchParameters(
  task: string,
  defaults?: Partial<Pick<GitHubRepositoryResearchParameters, "min_stars" | "result_count">>,
): GitHubRepositoryResearchParameters | null {
  const normalizedTask = task.trim().replace(/[.?!]+$/, "");
  const intent = normalizedTask.match(
    /^(find|recommend|suggest)\s+(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?github\s+(?:repositories|repos)\s+(?:for|about|related\s+to)\s+(.+?)(?:\s+(?:with\s+)?(?:over|more\s+than|at\s+least|above)\s+([\d,]+)\s+stars?)?$/i,
  );
  if (!intent || (!intent[4] && defaults?.min_stars === undefined)) return null;
  return {
    query: intent[3].trim(),
    min_stars: intent[4] ? Number(intent[4].replaceAll(",", "")) : defaults!.min_stars!,
    result_count: intent[2] ? parseCount(intent[2]) : defaults?.result_count ?? 3,
  };
}

export function routeCapability(
  task: string,
  registry: CapabilityRegistry = capabilityRegistry,
): CapabilityRouteDecision {
  const normalizedTask = task.trim().replace(/[.?!]+$/, "");
  const githubCapability = registry
    .findByFamily("github_repository_research")
    .sort((left, right) => right.version - left.version)[0];
  const githubParameters = extractGitHubRepositoryResearchParameters(task, githubCapability ? {
    min_stars: typeof githubCapability.sourceExample.min_stars === "number" ? githubCapability.sourceExample.min_stars : 0,
    result_count: typeof githubCapability.sourceExample.result_count === "number" ? githubCapability.sourceExample.result_count : 3,
  } : undefined);
  if (githubParameters) {
    if (!githubCapability) {
      return noMatch("No learned GitHub repository research capability exists in shared memory.");
    }
    return capabilityRouteDecisionSchema.parse({
      matched: true,
      capabilityId: githubCapability.id,
      capabilityName: githubCapability.name,
      family: githubCapability.family,
      confidence: /^(?:find|recommend|suggest)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i.test(normalizedTask) ? 0.99 : 0.95,
      parameters: githubParameters,
      reason: "The task matches GitHub repository research learned by the organization.",
    });
  }

  const learned = registry
    .findByFamily("comparative_product_research")
    .sort((left, right) => right.version - left.version)[0];

  if (!learned) {
    return noMatch("No learned comparative product research capability exists in shared memory.");
  }

  const intent = normalizedTask.match(
    /^(find|compare|recommend|suggest)\s+(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?/i,
  );
  if (!intent) return noMatch("The task is not a supported product research request.");

  const remainder = normalizedTask.slice(intent[0].length);
  const price = remainder.match(
    /\s+(under|below|less\s+than|up\s+to)\s*([$€£])?\s*(\d+(?:\.\d+)?)\s*(USD|CAD|EUR|GBP|AUD)?/i,
  );
  if (!price || price.index === undefined) {
    return noMatch("A maximum price is required for comparative product research.");
  }

  const productType = remainder.slice(0, price.index).trim().replace(/^(?:a|an|the)\s+/i, "");
  if (!productType) return noMatch("A product type is required.");

  const afterPrice = remainder.slice(price.index + price[0].length);
  const useCaseMatch = afterPrice.match(/^\s*(?:(?:suitable|best)\s+)?for\s+(.+)$/i);
  const useCase = useCaseMatch?.[1]?.trim();
  if (!useCase) return noMatch("An explicit use case is required.");

  const resultCount = parseCount(intent[2]);
  const explicitCurrency = price[4]?.toUpperCase();
  const currency = explicitCurrency ?? CURRENCY_SYMBOLS[price[2] ?? ""] ?? "USD";
  const usedDefault = !intent[2] || (!explicitCurrency && !price[2]);

  return capabilityRouteDecisionSchema.parse({
    matched: true,
    capabilityId: learned.id,
    capabilityName: learned.name,
    family: learned.family,
    confidence: usedDefault ? 0.9 : 0.98,
    parameters: {
      product_type: productType,
      max_price: Number(price[3]),
      currency,
      use_case: useCase,
      result_count: resultCount,
    },
    reason: "The task matches a product comparison capability learned by the organization.",
  });
}
