import "server-only";

import { z } from "zod";

export const browserUseConfig = {
  model: "gpt-5.6-luna",
  maxCostUsd: 0.3,
  proxyCountryCode: null,
} as const;

const browserUseEnvSchema = z.object({
  BROWSER_USE_API_KEY: z.string().min(1),
});

export type BrowserUseEnv = z.infer<typeof browserUseEnvSchema>;

export function getBrowserUseEnv(): BrowserUseEnv {
  return browserUseEnvSchema.parse({
    BROWSER_USE_API_KEY: process.env.BROWSER_USE_API_KEY,
  });
}
