import { beforeEach, describe, expect, it } from "vitest";
import type { SemanticCapability } from "../domain/capability";
import { createInMemoryCapabilityRegistry } from "./registry";
import { routeCapability } from "./router";

const learnedCapability: SemanticCapability = {
  id: "comparative-product-research:run-1",
  name: "comparative_product_research",
  description: "Research and compare products.",
  intentSignature: "comparative_product_research(product_type, max_price, currency, use_case, result_count)",
  family: "comparative_product_research",
  version: 1,
  parameters: [],
  strategy: [],
  invariants: [],
  fallbackTriggers: [],
  learnedFromRunId: "run-1",
  learnedByAgentId: "Agent 01",
  scope: "organization",
  createdAt: "2026-09-15T15:11:47.648Z",
  successfulUses: 0,
  deterministicUses: 0,
  executionState: "semantic",
  sourceExample: {},
};

const githubCapability: SemanticCapability = {
  ...learnedCapability,
  id: "github-repository-research:run-2",
  name: "github_repository_research",
  family: "github_repository_research",
  intentSignature: "github_repository_research(query, min_stars, result_count)",
};

describe("capability router", () => {
  const registry = createInMemoryCapabilityRegistry();

  beforeEach(() => {
    registry.clearForTests();
    registry.addCapability(learnedCapability);
  });

  it("matches the original product-research task", () => {
    const decision = routeCapability(
      "Find three mechanical keyboards under $180 USD for programming.",
      registry,
    );
    expect(decision).toMatchObject({
      matched: true,
      capabilityId: learnedCapability.id,
      parameters: {
        product_type: "mechanical keyboards",
        max_price: 180,
        currency: "USD",
        use_case: "programming",
        result_count: 3,
      },
    });
  });

  it("maps a different product type to the learned family", () => {
    const decision = routeCapability("Find 4 ergonomic mice under $120 USD for programming", registry);
    expect(decision.parameters).toMatchObject({ product_type: "ergonomic mice", result_count: 4 });
    expect(decision.family).toBe("comparative_product_research");
  });

  it("supports alternate comparison wording and currencies", () => {
    const decision = routeCapability(
      "Compare five noise cancelling headphones below $300 CAD for travel",
      registry,
    );
    expect(decision.parameters).toEqual({
      product_type: "noise cancelling headphones",
      max_price: 300,
      currency: "CAD",
      use_case: "travel",
      result_count: 5,
    });
  });

  it("defaults the result count to three", () => {
    const decision = routeCapability("Recommend monitors under $500 USD for development", registry);
    expect(decision.parameters?.result_count).toBe(3);
  });

  it("defaults currency to USD when no symbol or code is supplied", () => {
    const decision = routeCapability("Find 4 ergonomic mice under 120 for programming", registry);
    expect(decision.parameters?.currency).toBe("USD");
  });

  it("does not invent a missing maximum price", () => {
    const decision = routeCapability("Find four ergonomic mice for programming", registry);
    expect(decision.matched).toBe(false);
    expect(decision.reason).toContain("maximum price");
  });

  it("does not match an unrelated task", () => {
    expect(routeCapability("Schedule a meeting for tomorrow", registry).matched).toBe(false);
  });

  it("does not match when shared memory is empty", () => {
    registry.clearForTests();
    expect(routeCapability("Find 4 ergonomic mice under $120 for programming", registry).matched)
      .toBe(false);
  });

  it("selects only an actually learned capability family", () => {
    registry.clearForTests();
    registry.addCapability({ ...learnedCapability, id: "other", family: "travel_planning" });
    expect(routeCapability("Find 4 ergonomic mice under $120 for programming", registry).matched)
      .toBe(false);
  });

  it("routes GitHub repository research and extracts its parameters", () => {
    registry.addCapability(githubCapability);
    const decision = routeCapability(
      "Find 3 GitHub repos about workflow orchestration with at least 1,000 stars",
      registry,
    );
    expect(decision).toMatchObject({
      matched: true,
      capabilityId: githubCapability.id,
      parameters: { query: "workflow orchestration", min_stars: 1000, result_count: 3 },
    });
  });

  it("does not route GitHub research unless the family was learned", () => {
    expect(routeCapability(
      "Recommend 5 GitHub repositories for vector databases above 5000 stars",
      registry,
    ).matched).toBe(false);
  });
});
