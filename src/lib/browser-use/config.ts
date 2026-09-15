import { z } from "zod";

export const browserUseConfig = {
  model: "gpt-5.6-luna",
  maxCostUsd: 0.3,
  proxyCountryCode: null,
} as const;

const serverEnvSchema = z.object({
  BROWSER_USE_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables cannot be read in the browser.");
  }

  return serverEnvSchema.parse({
    BROWSER_USE_API_KEY: process.env.BROWSER_USE_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });
}
