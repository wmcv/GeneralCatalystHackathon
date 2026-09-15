import { z } from "zod";

export const githubRepositoryResearchResultSchema = z.object({
  repositories: z.array(z.object({
    name: z.string().min(1),
    owner: z.string().min(1),
    stars: z.number().int().nonnegative(),
    url: z.url().refine((url) => new URL(url).hostname === "github.com", {
      message: "Repository URL must use github.com.",
    }),
    description: z.string(),
  })),
});

export type GitHubRepositoryResearchResult = z.infer<
  typeof githubRepositoryResearchResultSchema
>;
