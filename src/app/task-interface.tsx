"use client";

import { useEffect, useRef, useState } from "react";
import { ResultRenderer } from "@/components/result-renderer";
import type { SemanticCapability } from "@/lib/domain/capability";
import type { ReplayTaskResult } from "@/lib/replay-layer/orchestrate";
import type { TraceEvent } from "@/lib/trace/types";

const EXAMPLE_PROMPT = "Find 3 GitHub repositories for browser automation with more than 1,000 stars.";

export default function TaskInterface() {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<ReplayTaskResult[]>([]);
  const [capabilities, setCapabilities] = useState<SemanticCapability[]>([]);
  const [running, setRunning] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [expandedCapability, setExpandedCapability] = useState<string | null>(null);
  const [fullTrace, setFullTrace] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void refreshMemory(); }, []);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "0px";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
  }, [prompt]);

  async function refreshMemory() {
    const response = await fetch("/api/capabilities");
    if (response.ok) setCapabilities((await response.json() as { capabilities: SemanticCapability[] }).capabilities);
  }

  async function runTask() {
    const task = prompt.trim();
    if (!task || running) return;
    const agentId = `Agent ${String(history.length + 1).padStart(2, "0")}`;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/replay/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, agentId }),
      });
      const body = await response.json() as ReplayTaskResult & { error?: string };
      if (!response.ok && !body.runId) throw new Error(body.error ?? "Replay could not run this task.");
      setHistory((current) => [...current, body]);
      setPrompt("");
      await refreshMemory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runTask();
    }
  }

  return <main className="replay-shell">
    <header className="topbar"><button className="wordmark" type="button" onClick={() => window.location.reload()}>REPLAY</button><button className="memory-trigger" type="button" onClick={() => setMemoryOpen(true)}>Collective memory{history.length > 0 ? ` · ${capabilities.length} ${capabilities.length === 1 ? "capability" : "capabilities"}` : ""}</button></header>
    <section className={`workspace${history.length ? " has-history" : ""}`}>
      {history.length === 0 ? <div className="welcome"><p className="eyebrow">REPLAY</p><h1>What should an agent do?</h1></div> : <div className="execution-history">{history.map((run) => <Execution key={run.runId} run={run} expanded={Boolean(fullTrace[run.runId])} onToggle={() => setFullTrace((current) => ({ ...current, [run.runId]: !current[run.runId] }))} />)}{running && <PendingExecution prompt={prompt.trim()} />}</div>}
      <div className="composer-wrap"><div className="composer"><textarea ref={textarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKeyDown} placeholder={history.length ? "Give an agent another task" : EXAMPLE_PROMPT} aria-label="Task for Replay" rows={2} disabled={running} /><button type="button" onClick={() => void runTask()} disabled={running || !prompt.trim()} aria-label="Run task">{running ? <span className="spinner" /> : <>Run <span>→</span></>}</button></div><p className="composer-note">Replay checks what your organization already knows before invoking an agent.</p>{error && <p className="error-message">{error}</p>}</div>
    </section>
    {memoryOpen && <div className="drawer-backdrop" onMouseDown={() => setMemoryOpen(false)}><aside className="memory-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Collective Memory"><div className="drawer-heading"><div><p>REPLAY</p><h2>Collective Memory</h2></div><button type="button" onClick={() => setMemoryOpen(false)} aria-label="Close collective memory">×</button></div>{capabilities.length === 0 ? <p className="empty-memory">No learned capabilities yet.<br />Run a task and Replay will remember successful procedures here.</p> : <div className="capability-list">{capabilities.map((capability) => { const expanded = expandedCapability === capability.id; return <button className="capability-item" type="button" key={capability.id} onClick={() => setExpandedCapability(expanded ? null : capability.id)}><span className="capability-row"><strong>{capability.name}</strong><em>{capability.executionState === "deterministic_ready" ? "Deterministic" : "Learning"}</em></span><small>{capability.description}</small><span className="capability-uses">Used {capability.successfulUses} {capability.successfulUses === 1 ? "time" : "times"}</span>{expanded && <span className="capability-details"><span>Learned by {capability.learnedByAgentId}</span><span>Parameters · {capability.parameters.map((parameter) => parameter.name).join(", ")}</span><span>Surface · {capability.execution?.surface?.origin ?? capability.execution?.surface?.kind ?? "web"}</span><span>Status · {capability.executionState.replaceAll("_", " ")}</span></span>}</button>; })}</div>}</aside></div>}
  </main>;
}

function PendingExecution({ prompt }: { prompt: string }) { return <article className="execution active-execution"><PromptBlock prompt={prompt} /><div className="trace-list"><div className="trace-row"><span>USER</span><p>Prompt received</p></div><div className="trace-row"><span>REPLAY</span><p>Interpreting task</p></div><div className="trace-row"><span>REPLAY</span><p>Searching collective memory…</p><i className="pulse" /></div></div></article>; }
function Execution({ run, expanded, onToggle }: { run: ReplayTaskResult; expanded: boolean; onToggle(): void }) { const visibleTrace = expanded ? run.trace : run.trace.slice(-4); return <article className="execution"><PromptBlock prompt={run.prompt} /><div className="trace-list">{visibleTrace.map((event) => <TraceRow event={event} key={event.id} />)}</div>{run.trace.length > 4 && <button className="trace-toggle" type="button" onClick={onToggle}>{expanded ? "Show less" : "Show full trace"}</button>}{run.capability && <div className="decision-summary"><span className="check">✓</span><div><strong>{run.capability.name}</strong><p>{run.decision === "reuse" ? `Learned previously · used ${run.capability.successfulUses} times` : run.deterministicReady ? "Learned and published to collective memory" : "Exploratory result · deterministic procedure not yet certified"}</p></div></div>}{run.result !== null && <ResultRenderer value={run.result} />}<RunMetrics run={run} />{run.error && <p className="run-warning">{run.error}</p>}</article>; }
function PromptBlock({ prompt }: { prompt: string }) { return <div className="prompt-block"><span>You</span><p>{prompt}</p></div>; }
function TraceRow({ event }: { event: TraceEvent }) { return <div className="trace-row"><span>{event.actor.toUpperCase()}</span><div><p>{event.label}</p>{event.detail && <small>{event.detail}</small>}</div></div>; }
function RunMetrics({ run }: { run: ReplayTaskResult }) { const executionTokens = run.metrics.execution.inputTokens + run.metrics.execution.outputTokens; return <div className="run-metrics"><span>{(run.metrics.elapsedMs / 1000).toFixed(1)}s</span><span>${run.metrics.execution.totalCostUsd.toFixed(5)}</span><span>{executionTokens} execution tokens</span><details><summary>Cost details</summary><div><p>Replay routing</p><strong>{run.metrics.routing ? `${run.metrics.routing.inputTokens + run.metrics.routing.outputTokens} tokens · $${(run.metrics.routing.costUsd ?? 0).toFixed(6)}` : "Local fallback · $0"}</strong><p>Agent execution</p><strong>{executionTokens} tokens · $${run.metrics.execution.llmCostUsd.toFixed(6)}</strong><p>Browser</p><strong>${run.metrics.execution.browserCostUsd.toFixed(6)}</strong></div></details></div>; }
