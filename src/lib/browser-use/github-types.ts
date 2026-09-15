import { z } from "zod";

const githubRepositorySchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1),
  stars: z.number().int().nonnegative(),
  url: z.url().refine((url) => new URL(url).hostname === "github.com", {
    message: "Repository URL must use github.com.",
  }),
  description: z.string(),
});

const githubRepositoriesSchema = z.array(githubRepositorySchema);

export const githubRepositoryResearchResultSchema = z.union([
  z.object({ repositories: githubRepositoriesSchema }),
  githubRepositoriesSchema,
]).transform((result) => Array.isArray(result) ? { repositories: result } : result);

export type GitHubRepositoryResearchResult = z.infer<
  typeof githubRepositoryResearchResultSchema
>;
