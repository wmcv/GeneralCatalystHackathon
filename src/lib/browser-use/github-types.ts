import { z } from "zod";

const githubRepositoryInputSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  stars: z.number().int().nonnegative(),
  url: z.url().refine((url) => new URL(url).hostname === "github.com", {
    message: "Repository URL must use github.com.",
  }),
  description: z.string(),
}).transform((repository, context) => {
  const combinedName = repository.fullName ?? repository.name;
  const parts = combinedName.split("/").filter(Boolean);
  const owner = repository.owner ?? (parts.length === 2 ? parts[0] : undefined);
  const name = parts.length === 2 ? parts[1] : repository.name;
  if (!owner) {
    context.addIssue({ code: "custom", path: ["owner"], message: "Repository owner is required." });
    return z.NEVER;
  }
  return { name, owner, stars: repository.stars, url: repository.url, description: repository.description };
});

const githubRepositoriesSchema = z.array(githubRepositoryInputSchema);

export function githubRepositoryIdentifier(value: { name: string; owner?: string; fullName?: string }): string {
  const combined = value.fullName ?? value.name;
  if (combined.includes("/")) return combined;
  return value.owner ? `${value.owner}/${combined}` : combined;
}

export const githubRepositoryResearchResultSchema = z.union([
  z.object({ repositories: githubRepositoriesSchema }),
  githubRepositoriesSchema,
]).transform((result) => Array.isArray(result) ? { repositories: result } : result);

export type GitHubRepositoryResearchResult = z.infer<
  typeof githubRepositoryResearchResultSchema
>;
