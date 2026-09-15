"use client";

import { useEffect, useRef, useState } from "react";
import type { GitHubRepositoryResearchResult } from "@/lib/browser-use/github-types";
import type { CapabilityRouteDecision } from "@/lib/capabilities/router";
import type { SemanticCapability } from "@/lib/domain/capability";
import type { DeterministicExecutionResult } from "@/lib/replay/deterministic-executor";
import type { DeterministicLearningResult } from "@/lib/replay/learn-deterministic-capability";

type DemoState = "initial" | "learning" | "learned" | "agent02" | "lookup" | "found" | "replaying" | "complete" | "error";

const AGENT_01_TASK = "Find 3 GitHub repositories for browser automation with over 1,000 stars.";
const AGENT_02_TASK = "Find 3 GitHub repositories for workflow orchestration with over 1,000 stars.";
const LEARNING_ACTIVITY = ["Searching GitHub…", "Inspecting repositories…", "Filtering by stars…", "Extracting repository metadata…"];
const DISCOVERY_REPOSITORIES: GitHubRepositoryResearchResult["repositories"] = [
  { owner: "vercel-labs", name: "agent-browser", stars: 42_613, url: "https://github.com/vercel-labs/agent-browser", description: "Browser automation for AI agents." },
  { owner: "lightpanda-io", name: "browser", stars: 35_360, url: "https://github.com/lightpanda-io/browser", description: "A headless browser designed for automation." },
  { owner: "SeleniumHQ", name: "selenium", stars: 34_492, url: "https://github.com/SeleniumHQ/selenium", description: "Browser automation framework and ecosystem." },
];

function githubCapability(): SemanticCapability {
  return {
    id: "github-repository-research:demo-agent-01",
    name: "github_repository_research",
    description: "Find public GitHub repositories by topic and minimum star count.",
    intentSignature: "github_repository_research(query, min_stars, result_count)",
    family: "github_repository_research",
    version: 1,
    parameters: [
      { name: "query", type: "string", required: true, description: "Repository topic query." },
      { name: "min_stars", type: "number", required: true, description: "Minimum GitHub star count." },
      { name: "result_count", type: "number", required: true, description: "Number of repositories." },
    ],
    strategy: [{ stage: "Search GitHub", objective: "Find public repositories matching the topic and star threshold.", preferredEvidence: ["GitHub repository search", "GitHub repository pages"], completionCondition: "The requested number of qualifying repositories is collected." }],
    invariants: ["Every result is a public GitHub repository.", "Every result meets the minimum star threshold."],
    fallbackTriggers: ["GitHub blocks public repository search."],
    learnedFromRunId: "github-demo-agent-01",
    learnedByAgentId: "Agent 01",
    scope: "organization",
    createdAt: new Date().toISOString(),
    successfulUses: 0,
    deterministicUses: 0,
    executionState: "semantic",
    sourceExample: { query: "browser automation", min_stars: 1000, result_count: 3 },
  };
}

function repositoriesFrom(value: unknown): GitHubRepositoryResearchResult["repositories"] {
  if (Array.isArray(value)) return value as GitHubRepositoryResearchResult["repositories"];
  if (value && typeof value === "object" && "repositories" in value) return (value as GitHubRepositoryResearchResult).repositories;
  return [];
}

export default function ReplayDemo() {
  const [state, setState] = useState<DemoState>("initial");
  const [activityIndex, setActivityIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [capability, setCapability] = useState<SemanticCapability | null>(null);
  const [learning, setLearning] = useState<DeterministicLearningResult | null>(null);
  const [routeDecision, setRouteDecision] = useState<CapabilityRouteDecision | null>(null);
  const [replay, setReplay] = useState<DeterministicExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const pendingRequest = useRef(false);

  useEffect(() => {
    if (state !== "learning" && state !== "replaying") return;
    const started = Date.now();
    const elapsedTimer = window.setInterval(() => setElapsed(Date.now() - started), 100);
    const activityTimer = state === "learning" ? window.setInterval(() => setActivityIndex((index) => Math.min(index + 1, LEARNING_ACTIVITY.length - 1)), 5_000) : undefined;
    return () => {
      window.clearInterval(elapsedTimer);
      if (activityTimer) window.clearInterval(activityTimer);
    };
  }, [state]);

  async function learnTask() {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    setState("learning");
    setElapsed(0);
    setActivityIndex(0);
    setError(null);
    try {
      const existingResponse = await fetch("/api/capabilities/learn");
      if (existingResponse.ok) {
        const existing = await existingResponse.json() as { capabilities: SemanticCapability[] };
        const learned = existing.capabilities.find((item) => item.family === "github_repository_research" && item.executionState === "deterministic_ready");
        if (learned) {
          setCapability(learned);
          setState("learned");
          return;
        }
      }
      const response = await fetch("/api/capabilities/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: githubCapability(), sourceParameters: { query: "browser automation", min_stars: 1000, result_count: 3 } }),
      });
      const body = await response.json() as DeterministicLearningResult;
      if (!response.ok || !body.deterministicReady) throw new Error(body.error ?? "The workflow could not be learned.");
      setLearning(body);
      setCapability(body.capability);
      setState("learned");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setState("error");
    } finally {
      pendingRequest.current = false;
    }
  }

  async function checkMemory() {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    setState("lookup");
    try {
      const [response] = await Promise.all([
        fetch("/api/capabilities/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: AGENT_02_TASK, requestingAgentId: "Agent 02" }) }),
        new Promise((resolve) => window.setTimeout(resolve, 700)),
      ]);
      const decision = await response.json() as CapabilityRouteDecision;
      if (!response.ok || !decision.matched) throw new Error(decision.reason);
      setRouteDecision(decision);
      setState("found");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setState("error");
    } finally {
      pendingRequest.current = false;
    }
  }

  async function runInstantly() {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    setState("replaying");
    setElapsed(0);
    try {
      const response = await fetch("/api/replay/deterministic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: AGENT_02_TASK, requestingAgentId: "Agent 02" }) });
      const body = await response.json() as DeterministicExecutionResult;
      if (!response.ok || !body.deterministicSuccess) throw new Error(body.validationError ?? body.error ?? "Deterministic execution failed.");
      setReplay(body);
      setState("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setState("error");
    } finally {
      pendingRequest.current = false;
    }
  }

  function reset() {
    if (pendingRequest.current) return;
    setState("initial"); setLearning(null); setReplay(null); setRouteDecision(null); setError(null); setMemoryOpen(false);
  }

  const memoryVisible = !["initial", "learning", "error"].includes(state) && capability;
  return (
    <main className="demo-shell">
      <header className="brand-row">
        <button className="wordmark" disabled={state === "learning" || state === "lookup" || state === "replaying"} onClick={reset} type="button">REPLAY</button>
        {memoryVisible && <div className="memory-wrap"><button className="memory-button" onClick={() => setMemoryOpen((open) => !open)} type="button"><span>Memory</span><strong>1 capability</strong></button>{memoryOpen && <MemoryPopover capability={capability} />}</div>}
      </header>
      <section className="stage" aria-live="polite">
        {state === "initial" && <InitialAct onLearn={learnTask} />}
        {state === "learning" && <LearningAct activity={LEARNING_ACTIVITY[activityIndex]} elapsed={elapsed} />}
        {state === "learned" && capability && <LearnedAct capability={capability} onContinue={() => setState("agent02")} />}
        {state === "agent02" && <AgentTwoAct onCheck={checkMemory} />}
        {state === "lookup" && <LookupAct />}
        {state === "found" && capability && routeDecision && <FoundAct capability={capability} onRun={runInstantly} />}
        {state === "replaying" && <ReplayAct elapsed={elapsed} />}
        {state === "complete" && replay && <CompleteAct learning={learning} replay={replay} />}
        {state === "error" && <ErrorAct error={error} onReset={reset} />}
      </section>
      <footer className="demo-footer"><span className="footer-context">Research Agent <i /> Organization: Demo Workspace</span><button disabled={state === "learning" || state === "lookup" || state === "replaying"} onClick={reset} type="button">Reset demo</button></footer>
    </main>
  );
}

function InitialAct({ onLearn }: { onLearn(): void }) {
  return <div className="act initial-act"><p className="eyebrow">REPLAY</p><h1>One agent learns.<br /><span>Every agent remembers.</span></h1><TaskPrompt agent="Agent 01" task={AGENT_01_TASK} /><PrimaryButton onClick={onLearn}>Learn this task</PrimaryButton></div>;
}

function LearningAct({ activity, elapsed }: { activity: string; elapsed: number }) {
  return <div className="act learning-act"><p className="act-number">01 — LEARN</p><h2>Agent 01 is learning<br />this workflow.</h2><p className="activity" key={activity}>{activity}</p><p className="quiet-metric">{formatSeconds(elapsed)} <span /> Building reusable procedure</p></div>;
}

function LearnedAct({ capability, onContinue }: { capability: SemanticCapability; onContinue(): void }) {
  return <div className="act learned-act"><p className="act-number">02 — REMEMBER</p><h2 className="single-word">Learned.</h2><p className="capability-name">{capability.name}</p><div className="parameter-line"><span>query</span><span>min_stars</span><span>result_count</span></div><p className="published">Published to organization memory</p><p className="secondary">Learned by Agent 01 <span /> Available to every agent</p><div className="procedure"><span>Search</span><i>→</i><span>Filter</span><i>→</i><span>Extract</span><i>→</i><span>Return</span></div><TextButton onClick={onContinue}>Meet Agent 02</TextButton></div>;
}

function AgentTwoAct({ onCheck }: { onCheck(): void }) {
  return <div className="act agent-act"><p className="act-number">03 — REUSE</p><TaskPrompt agent="Agent 02" task={AGENT_02_TASK} /><PrimaryButton onClick={onCheck}>Check shared memory</PrimaryButton></div>;
}

function LookupAct() { return <div className="act lookup-act"><p className="act-number">03 — REUSE</p><h2>Searching<br />organization memory…</h2></div>; }

function FoundAct({ capability, onRun }: { capability: SemanticCapability; onRun(): void }) {
  return <div className="act found-act"><p className="act-number">03 — REUSE</p><h2 className="single-word">Already learned.</h2><p className="capability-name">{capability.name}</p><p className="secondary">Learned by Agent 01 <span /> Shared with organization</p><PrimaryButton onClick={onRun}>Run instantly</PrimaryButton></div>;
}

function ReplayAct({ elapsed }: { elapsed: number }) {
  return <div className="act replay-act"><p className="act-number">04 — EXECUTE</p><h2>Deterministic<br />execution</h2><p className="activity">Running the learned procedure…</p><p className="secondary strong">No model reasoning required</p><p className="quiet-metric">{formatSeconds(elapsed)}</p></div>;
}

function CompleteAct({ learning, replay }: { learning: DeterministicLearningResult | null; replay: DeterministicExecutionResult }) {
  const learned = learning?.outcome ?? null;
  const learningMs = learned?.elapsedMs ?? 50_664;
  const learningCost = Number(learned?.totalCostUsd ?? 0.013918);
  const replayCost = Number(replay.totalCostUsd ?? 0.0003333333);
  const speedup = safeRatio(learningMs, replay.elapsedMs, 12);
  const cheaper = safeRatio(learningCost, replayCost, 42);
  const discoveryRepositories = repositoriesFrom(learned?.structuredResult);
  return <div className="act complete-act"><p className="act-number">REPLAY REMEMBERED</p><div className="hero-metrics"><p><strong>{Math.round(speedup)}×</strong><span>faster</span></p><p><strong>{Math.round(cheaper)}×</strong><span>cheaper</span></p><p><strong>0</strong><span>LLM tokens</span></p></div><Comparison learning={learned} replay={replay} /><div className="result-columns"><RepositoryList title="Agent 01 · browser automation" repositories={discoveryRepositories.length > 0 ? discoveryRepositories : DISCOVERY_REPOSITORIES} /><RepositoryList title="Agent 02 · workflow orchestration" repositories={repositoriesFrom(replay.structuredResult)} /></div></div>;
}

function TaskPrompt({ agent, task }: { agent: string; task: string }) {
  const lines = task.replace(" with over", "\nwith over").split("\n");
  return <div className="task-prompt"><p>{agent}</p><h2>{lines.map((line) => <span key={line}>{line}</span>)}</h2></div>;
}

function RepositoryList({ title, repositories }: { title: string; repositories: GitHubRepositoryResearchResult["repositories"] }) {
  return <section className="repo-list"><h3>{title}</h3>{repositories.map((repo) => <a href={repo.url} key={repo.url} rel="noreferrer" target="_blank"><span><strong>{repo.owner}/{repo.name}</strong><small>{repo.description}</small></span><em>{formatStars(repo.stars)} ★</em></a>)}</section>;
}

function Comparison({ learning, replay }: { learning: DeterministicLearningResult["outcome"]; replay: DeterministicExecutionResult }) {
  const rows = [
    ["Time", formatMetricSeconds(learning?.elapsedMs ?? 50_664), formatMetricSeconds(replay.elapsedMs)],
    ["Input tokens", formatInteger(learning?.totalInputTokens ?? 469_772), formatInteger(replay.totalInputTokens ?? 0)],
    ["Output tokens", formatInteger(learning?.totalOutputTokens ?? 1_512), formatInteger(replay.totalOutputTokens ?? 0)],
    ["LLM cost", formatUsd(learning?.llmCostUsd ?? "0.013918"), formatUsd(replay.llmCostUsd ?? "0")],
    ["Total cost", formatUsd(learning?.totalCostUsd ?? "0.013918"), formatUsd(replay.totalCostUsd ?? "0.000333")],
  ];
  return <div className="comparison" role="table" aria-label="Learning and replay comparison"><div className="comparison-row comparison-head" role="row"><span /><span>Learning</span><span>Replay</span></div>{rows.map(([label, first, second]) => <div className="comparison-row" role="row" key={label}><strong>{label}</strong><span>{first}</span><span>{second}</span></div>)}</div>;
}

function MemoryPopover({ capability }: { capability: SemanticCapability }) { return <aside className="memory-popover"><strong>{capability.name}</strong><span>Learned by Agent 01</span><span className="accent">Deterministic</span><span>{capability.deterministicUses} successful reuse</span></aside>; }
function ErrorAct({ error, onReset }: { error: string | null; onReset(): void }) { return <div className="act error-act"><p className="act-number">SOMETHING CHANGED</p><h2>Replay paused.</h2><p>{error ?? "The demo could not continue."}</p><PrimaryButton onClick={onReset}>Start demo</PrimaryButton></div>; }
function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick(): void }) { return <button className="primary-button" onClick={onClick} type="button">{children}<span>→</span></button>; }
function TextButton({ children, onClick }: { children: React.ReactNode; onClick(): void }) { return <button className="text-button" onClick={onClick} type="button">{children} <span>→</span></button>; }
function finiteNumber(value: number, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function safeRatio(numerator: number, denominator: number, fallback: number) { return denominator > 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : fallback; }
function formatSeconds(ms: number) { return `${(finiteNumber(ms) / 1000).toFixed(1)}s`; }
function formatMetricSeconds(ms: number) { return `${(finiteNumber(ms) / 1000).toFixed(3)}s`; }
function formatInteger(value: number) { return new Intl.NumberFormat("en-US").format(finiteNumber(value)); }
function formatUsd(value: string) { const amount = Number(value); return `$${finiteNumber(amount).toFixed(amount === 0 ? 0 : 6)}`; }
function formatStars(value: number) { return `${(value / 1000).toFixed(1)}k`; }
