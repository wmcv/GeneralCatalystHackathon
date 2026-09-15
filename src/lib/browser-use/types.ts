import { z } from "zod";

export const browserUseSpikeResultSchema = z.object({
  summary: z.string(),
  products: z.array(
    z.object({
      name: z.string(),
      price: z.string(),
      url: z.url(),
      whySuitable: z.string(),
    }),
  ),
  sources: z.array(
    z.object({
      url: z.url(),
      description: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
});

export type BrowserUseSpikeResult = z.infer<typeof browserUseSpikeResultSchema>;

export interface BrowserUseSpikeResponse {
  runId: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  elapsedMs: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: string | null;
  rawResult: string | null;
  parsedResult: BrowserUseSpikeResult | null;
  validationError: string | null;
  error: string | null;
  eventTypes: string[];
  liveViewUrlObserved: boolean;
}
