import { describe, expect, it } from "vitest";
import type { SemanticCapability } from "../domain/capability";
import { validateCapabilityResult } from "./result-validation";

const capability = { family: "github_repository_research" } as SemanticCapability;
const parameters = { query: "automation", min_stars: 1000, result_count: 2 };
const repositories = [
  { name: "one", owner: "owner", stars: 2000, url: "https://github.com/owner/one", description: "One" },
  { name: "two", owner: "owner", stars: 1500, url: "https://github.com/owner/two", description: "Two" },
];

describe("GitHub capability result validation", () => {
  it("accepts the exact count of qualifying GitHub repositories", () => {
    expect(validateCapabilityResult(capability, parameters, { repositories })).toMatchObject({
      validationError: null,
      structuredResult: { repositories },
    });
  });

  it("rejects a repository below the star threshold", () => {
    const result = validateCapabilityResult(capability, parameters, {
      repositories: [{ ...repositories[0], stars: 999 }, repositories[1]],
    });
    expect(result.validationError).toContain("minimum is 1000");
  });

  it("rejects the wrong result count", () => {
    const result = validateCapabilityResult(capability, parameters, {
      repositories: repositories.slice(0, 1),
    });
    expect(result.validationError).toContain("Expected 2 repositories");
  });

  it("rejects non-GitHub URLs", () => {
    const result = validateCapabilityResult(capability, parameters, {
      repositories: [{ ...repositories[0], url: "https://example.com/one" }, repositories[1]],
    });
    expect(result.structuredResult).toBeNull();
  });
});
