"use client";

import { useState } from "react";
import type { BrowserUseSpikeResponse } from "@/lib/browser-use/types";

export default function Home() {
  const [result, setResult] = useState<BrowserUseSpikeResponse | null>(null);
  const [running, setRunning] = useState(false);

  async function runSpike() {
    setRunning(true);
    setResult(null);

    try {
      const response = await fetch("/api/browser-use/spike", { method: "POST" });
      setResult((await response.json()) as BrowserUseSpikeResponse);
    } catch (error) {
      setResult({
        runId: null,
        status: "failed",
        createdAt: null,
        updatedAt: null,
        elapsedMs: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalCostUsd: null,
        rawResult: null,
        parsedResult: null,
        validationError: null,
        error: error instanceof Error ? error.message : String(error),
        eventTypes: [],
        liveViewUrlObserved: false,
        liveViewUrl: null,
        traceEvents: [],
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-3xl space-y-6 text-center">
        <h1 className="text-4xl font-semibold tracking-[0.3em]">REPLAY</h1>
        <p className="text-lg leading-relaxed text-zinc-400">
          Agents should explore once.
          <br />
          Then remember how.
        </p>
        <p className="font-mono text-sm text-emerald-400">[ infrastructure ready ]</p>
        <button
          className="border border-zinc-600 px-4 py-2 font-mono text-sm disabled:opacity-50"
          disabled={running}
          onClick={runSpike}
          type="button"
        >
          [ {running ? "Running…" : "Run Browser Use Spike"} ]
        </button>
        {result && (
          <div className="space-y-3 text-left font-mono text-sm">
            <p>Status: {result.status}</p>
            <p>Elapsed: {result.elapsedMs} ms</p>
            <p>Cost: {result.totalCostUsd ?? "unavailable"}</p>
            <p>
              Tokens: {result.totalInputTokens ?? "unavailable"} input /{" "}
              {result.totalOutputTokens ?? "unavailable"} output
            </p>
            {result.liveViewUrl && (
              <p>
                <a className="underline" href={result.liveViewUrl} rel="noreferrer" target="_blank">
                  Open live browser
                </a>
              </p>
            )}
            {result.traceEvents.length > 0 && (
              <ol className="space-y-1 border-l border-zinc-700 pl-4">
                {result.traceEvents.map((event) => (
                  <li key={event.id}>
                    <span className="text-zinc-500">
                      {formatElapsed(result.traceEvents[0].timestamp, event.timestamp)}
                    </span>{" "}
                    {event.label}
                    {event.detail && <span className="text-zinc-500"> — {event.detail}</span>}
                  </li>
                ))}
              </ol>
            )}
            {result.parsedResult?.products.map((product) => (
              <div className="border border-zinc-800 p-3" key={product.url}>
                <a className="underline" href={product.url} rel="noreferrer" target="_blank">
                  {product.name} — {product.price}
                </a>
                <p className="mt-1 text-zinc-400">{product.whySuitable}</p>
              </div>
            ))}
            {(result.error || result.validationError) && (
              <pre className="overflow-auto whitespace-pre-wrap text-red-400">
                {result.error ?? result.validationError}
              </pre>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function formatElapsed(firstTimestamp: string, timestamp: string): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.parse(timestamp) - Date.parse(firstTimestamp)) / 1000),
  );
  const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
  const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
