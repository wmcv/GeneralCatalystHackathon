"use client";

import { useEffect, useRef, useState } from "react";
import type { GitHubRepositoryResearchResult } from "@/lib/browser-use/github-types";
import type { CapabilityRouteDecision } from "@/lib/capabilities/router";
import type { SemanticCapability } from "@/lib/domain/capability";
import { createInitialDemoPrompts, snapshotRepeatPrompt } from "@/lib/replay/demo-flow";
import type { DeterministicBrowserOutcome, DeterministicExecutionResult } from "@/lib/replay/deterministic-executor";
import type { DeterministicLearningResult } from "@/lib/replay/learn-deterministic-capability";

type DemoState = "initial" | "learning" | "learned" | "repeat" | "repeating" | "repeat_complete" | "transfer" | "lookup" | "found" | "transferring" | "complete" | "error";
interface RunView { elapsedMs: number; totalInputTokens: number | null; totalOutputTokens: number | null; llmCostUsd: string | null; totalCostUsd: string | null; structuredResult: unknown; }
const LEARNING_ACTIVITY = ["Searching GitHub…", "Inspecting repositories…", "Filtering by stars…", "Extracting repository metadata…"];

function githubCapability(): SemanticCapability {
  return {
    id: "github-repository-research:demo-agent-01", name: "github_repository_research", description: "Find public GitHub repositories by topic and minimum star count.", intentSignature: "github_repository_research(query, min_stars, result_count)", family: "github_repository_research", version: 1,
    parameters: [{ name: "query", type: "string", required: true, description: "Repository topic query." }, { name: "min_stars", type: "number", required: true, description: "Minimum GitHub star count." }, { name: "result_count", type: "number", required: true, description: "Number of repositories." }],
    strategy: [{ stage: "Search GitHub", objective: "Find public repositories matching the topic and star threshold.", preferredEvidence: ["GitHub repository search", "GitHub repository pages"], completionCondition: "The requested number of qualifying repositories is collected." }],
    invariants: ["Every result is a public GitHub repository.", "Every result meets the minimum star threshold."], fallbackTriggers: ["GitHub blocks public repository search."], learnedFromRunId: "github-demo-agent-01", learnedByAgentId: "Agent 01", scope: "organization", createdAt: new Date().toISOString(), successfulUses: 0, deterministicUses: 0, executionState: "semantic", sourceExample: { query: "browser automation", min_stars: 1000, result_count: 3 },
  };
}

function repositoriesFrom(value: unknown): GitHubRepositoryResearchResult["repositories"] {
  if (Array.isArray(value)) return value as GitHubRepositoryResearchResult["repositories"];
  if (value && typeof value === "object" && "repositories" in value) return (value as GitHubRepositoryResearchResult).repositories;
  return [];
}

function runView(outcome: DeterministicBrowserOutcome | DeterministicExecutionResult): RunView {
  return { elapsedMs: outcome.elapsedMs, totalInputTokens: outcome.totalInputTokens, totalOutputTokens: outcome.totalOutputTokens, llmCostUsd: outcome.llmCostUsd, totalCostUsd: outcome.totalCostUsd, structuredResult: outcome.structuredResult };
}

export default function ReplayDemo() {
  const defaults = createInitialDemoPrompts();
  const [state, setState] = useState<DemoState>("initial");
  const [activityIndex, setActivityIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [capability, setCapability] = useState<SemanticCapability | null>(null);
  const [agent1Prompt, setAgent1Prompt] = useState(defaults.agent1);
  const [agent2Prompt, setAgent2Prompt] = useState(defaults.agent2);
  const [agent3Prompt, setAgent3Prompt] = useState(defaults.agent3);
  const [agent1Run, setAgent1Run] = useState<RunView | null>(null);
  const [agent2Run, setAgent2Run] = useState<DeterministicExecutionResult | null>(null);
  const [agent3Run, setAgent3Run] = useState<DeterministicExecutionResult | null>(null);
  const [routeDecision, setRouteDecision] = useState<CapabilityRouteDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);
  const pendingRequest = useRef(false);
  const pending = ["learning", "repeating", "lookup", "transferring"].includes(state);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const elapsedTimer = window.setInterval(() => setElapsed(Date.now() - started), 100);
    const activityTimer = state === "learning" ? window.setInterval(() => setActivityIndex((index) => Math.min(index + 1, LEARNING_ACTIVITY.length - 1)), 5_000) : undefined;
    return () => { window.clearInterval(elapsedTimer); if (activityTimer) window.clearInterval(activityTimer); };
  }, [pending, state]);

  async function learnTask() {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    const submittedPrompt = agent1Prompt;
    setAgent2Prompt(snapshotRepeatPrompt(submittedPrompt));
    setState("learning"); setElapsed(0); setActivityIndex(0); setError(null);
    try {
      const existingResponse = await fetch("/api/capabilities/learn");
      if (existingResponse.ok) {
        const existing = await existingResponse.json() as { capabilities: SemanticCapability[]; runs?: Array<{ id: string; capabilityId?: string; executionPhase?: string; durationMs?: number; totalInputTokens?: number; totalOutputTokens?: number; llmCostUsd?: number; totalCostUsd?: number; result?: unknown }> };
        const learned = existing.capabilities.find((item) => item.family === "github_repository_research");
        const routeResponse = learned ? await fetch("/api/capabilities/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: submittedPrompt, requestingAgentId: "Agent 01" }) }) : null;
        const route = routeResponse?.ok ? await routeResponse.json() as CapabilityRouteDecision : null;
        const sourceMatches = learned && route?.matched && JSON.stringify(learned.sourceExample) === JSON.stringify(route.parameters);
        const learningRun = learned ? existing.runs?.find((run) => run.capabilityId === learned.id && run.executionPhase === "learning") : undefined;
        if (learned && sourceMatches && learned.executionState === "deterministic_ready") {
          if (learningRun) setAgent1Run(storedRunView(learningRun));
          setCapability(learned); setState("learned"); return;
        }
        if (learned && sourceMatches && learned.executionState === "learning" && learningRun) {
          const confirmationResponse = await fetch("/api/capabilities/learn", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilityId: learned.id, sessionId: learningRun.id }) });
          if (confirmationResponse.ok) {
            const confirmed = await confirmationResponse.json() as { capability: SemanticCapability };
            setAgent1Run(storedRunView(learningRun)); setCapability(confirmed.capability); setState("learned"); return;
          }
        }
      }
      const response = await fetch("/api/capabilities/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability: githubCapability(), task: submittedPrompt }) });
      const body = await response.json() as DeterministicLearningResult;
      if (!response.ok || !body.deterministicReady || !body.outcome) throw new Error(body.error ?? "The workflow could not be learned.");
      setAgent1Run(runView(body.outcome)); setCapability(body.capability); setState("learned");
    } catch (caught) { fail(caught); } finally { pendingRequest.current = false; }
  }

  async function executeRepeat() {
    if (pendingRequest.current) return;
    pendingRequest.current = true; setState("repeating"); setElapsed(0); setError(null);
    try { const result = await executeDeterministically(agent2Prompt, "Agent 02"); setAgent2Run(result); incrementLocalUses(); setState("repeat_complete"); }
    catch (caught) { fail(caught); } finally { pendingRequest.current = false; }
  }

  async function checkTransfer() {
    if (pendingRequest.current) return;
    pendingRequest.current = true; setState("lookup"); setError(null);
    try {
      const [response] = await Promise.all([fetch("/api/capabilities/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: agent3Prompt, requestingAgentId: "Agent 03" }) }), new Promise((resolve) => window.setTimeout(resolve, 700))]);
      const decision = await response.json() as CapabilityRouteDecision;
      if (!response.ok || !decision.matched) throw new Error(decision.reason);
      setRouteDecision(decision); setState("found");
    } catch (caught) { fail(caught); } finally { pendingRequest.current = false; }
  }

  async function executeTransfer() {
    if (pendingRequest.current) return;
    pendingRequest.current = true; setState("transferring"); setElapsed(0);
    try { const result = await executeDeterministically(agent3Prompt, "Agent 03"); setAgent3Run(result); incrementLocalUses(); setState("complete"); }
    catch (caught) { fail(caught); } finally { pendingRequest.current = false; }
  }

  async function executeDeterministically(task: string, requestingAgentId: string) {
    const response = await fetch("/api/replay/deterministic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, requestingAgentId }) });
    const body = await response.json() as DeterministicExecutionResult;
    if (!response.ok || !body.deterministicSuccess) throw new Error(body.validationError ?? body.error ?? "Deterministic execution failed.");
    return body;
  }

  function incrementLocalUses() { setCapability((current) => current ? { ...current, successfulUses: current.successfulUses + 1, deterministicUses: current.deterministicUses + 1 } : current); }
  function fail(caught: unknown) { setError(caught instanceof Error ? caught.message : String(caught)); setState("error"); }
  function reset() { if (pendingRequest.current) return; const prompts = createInitialDemoPrompts(); setState("initial"); setAgent1Prompt(prompts.agent1); setAgent2Prompt(prompts.agent2); setAgent3Prompt(prompts.agent3); setAgent1Run(null); setAgent2Run(null); setAgent3Run(null); setRouteDecision(null); setError(null); setMemoryOpen(false); }

  async function clearMemory() {
    if (!capability || pendingRequest.current || !window.confirm("Delete this capability and its Browser Use workspace?")) return;
    pendingRequest.current = true; setClearingMemory(true);
    try { const response = await fetch("/api/capabilities/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilityId: capability.id }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Organization memory could not be cleared."); setCapability(null); pendingRequest.current = false; reset(); }
    catch (caught) { fail(caught); } finally { pendingRequest.current = false; setClearingMemory(false); }
  }

  const memoryVisible = !["initial", "learning", "error"].includes(state) && capability;
  return <main className="demo-shell"><header className="brand-row"><button className="wordmark" disabled={pending} onClick={reset} type="button">REPLAY</button>{memoryVisible && <div className="memory-wrap"><button className="memory-button" onClick={() => setMemoryOpen((open) => !open)} type="button"><span>Organization memory</span><strong>1 capability</strong></button>{memoryOpen && <MemoryPopover capability={capability} clearing={clearingMemory} onClear={clearMemory} />}</div>}</header><section className="stage" aria-live="polite">
    {state === "initial" && <InitialAct prompt={agent1Prompt} onPromptChange={setAgent1Prompt} onLearn={learnTask} />}
    {state === "learning" && <WorkingAct number="01 — LEARN" title={<>Agent 01 is learning<br />this workflow.</>} activity={LEARNING_ACTIVITY[activityIndex]} elapsed={elapsed} note="Building reusable procedure" />}
    {state === "learned" && capability && <LearnedAct capability={capability} run={agent1Run} onContinue={() => setState("repeat")} />}
    {state === "repeat" && <RepeatAct prompt={agent2Prompt} onRun={executeRepeat} />}
    {state === "repeating" && <WorkingAct number="02 — REPEAT" title={<>No reasoning<br />repeated.</>} activity="Running from organization memory…" elapsed={elapsed} note="Deterministic execution" />}
    {state === "repeat_complete" && agent2Run && <RepeatCompleteAct run={agent2Run} onContinue={() => setState("transfer")} />}
    {state === "transfer" && <TransferAct prompt={agent3Prompt} onPromptChange={setAgent3Prompt} onCheck={checkTransfer} />}
    {state === "lookup" && <LookupAct />}
    {state === "found" && capability && routeDecision && <FoundAct capability={capability} onRun={executeTransfer} />}
    {state === "transferring" && <WorkingAct number="03 — TRANSFER" title={<>New task.<br />Same capability.</>} activity="Running the learned procedure…" elapsed={elapsed} note="No model reasoning required" />}
    {state === "complete" && agent1Run && agent2Run && agent3Run && <CompleteAct prompts={{ agent1: agent1Prompt, agent2: agent2Prompt, agent3: agent3Prompt }} runs={{ agent1: agent1Run, agent2: runView(agent2Run), agent3: runView(agent3Run) }} />}
    {state === "error" && <ErrorAct error={error} onReset={reset} />}
  </section><footer className="demo-footer"><span className="footer-context">Research Agents <i /> Organization: Demo Workspace</span><button disabled={pending} onClick={reset} type="button">Restart walkthrough</button></footer></main>;
}

function storedRunView(run: { durationMs?: number; totalInputTokens?: number; totalOutputTokens?: number; llmCostUsd?: number; totalCostUsd?: number; result?: unknown }): RunView { return { elapsedMs: run.durationMs ?? 0, totalInputTokens: run.totalInputTokens ?? null, totalOutputTokens: run.totalOutputTokens ?? null, llmCostUsd: run.llmCostUsd === undefined ? null : String(run.llmCostUsd), totalCostUsd: run.totalCostUsd === undefined ? null : String(run.totalCostUsd), structuredResult: run.result ?? null }; }
function InitialAct({ prompt, onPromptChange, onLearn }: { prompt: string; onPromptChange(value: string): void; onLearn(): void }) { return <div className="act initial-act"><p className="eyebrow">REPLAY</p><h1>One agent learns.<br /><span>Every agent remembers.</span></h1><EditableTaskPrompt agent="Agent 01 · Learn" value={prompt} onChange={onPromptChange} /><PrimaryButton onClick={onLearn}>Learn this task</PrimaryButton></div>; }
function WorkingAct({ number, title, activity, elapsed, note }: { number: string; title: React.ReactNode; activity: string; elapsed: number; note: string }) { return <div className="act working-act"><p className="act-number">{number}</p><h2>{title}</h2><p className="activity" key={activity}>{activity}</p><p className="quiet-metric">{formatSeconds(elapsed)} <span /> {note}</p></div>; }
function LearnedAct({ capability, run, onContinue }: { capability: SemanticCapability; run: RunView | null; onContinue(): void }) { const repositories = repositoriesFrom(run?.structuredResult); return <div className="act learned-act"><p className="act-number">01 — LEARN</p><h2 className="single-word">Learned.</h2><p className="capability-name">{capability.name}</p><div className="parameter-line"><span>query</span><span>min_stars</span><span>result_count</span></div><p className="published">Published to organization memory</p><p className="secondary">Learned by Agent 01 <span /> Available to every agent</p><div className="procedure"><span>Search</span><i>→</i><span>Filter</span><i>→</i><span>Extract</span><i>→</i><span>Return</span></div><RepositoryList title={`What Agent 01 found · ${repositories.length} results`} repositories={repositories} compact /><TextButton onClick={onContinue}>Meet Agent 02</TextButton></div>; }
function RepeatAct({ prompt, onRun }: { prompt: string; onRun(): void }) { return <div className="act agent-act"><p className="act-number">02 — REPEAT</p><h2 className="story-title">Same request.<br /><span>Different agent.</span></h2><PromptQuote agent="Agent 02" prompt={prompt} /><PrimaryButton onClick={onRun}>Run from memory</PrimaryButton></div>; }
function RepeatCompleteAct({ run, onContinue }: { run: DeterministicExecutionResult; onContinue(): void }) { return <div className="act repeat-complete-act"><p className="act-number">02 — REPEAT</p><h2 className="single-word">Repeated.</h2><p className="published">No reasoning repeated.</p><InlineMetrics run={runView(run)} /><RepositoryList title="Agent 02 result" repositories={repositoriesFrom(run.structuredResult)} compact /><TextButton onClick={onContinue}>Meet Agent 03</TextButton></div>; }
function TransferAct({ prompt, onPromptChange, onCheck }: { prompt: string; onPromptChange(value: string): void; onCheck(): void }) { return <div className="act agent-act"><p className="act-number">03 — TRANSFER</p><h2 className="story-title">New task.<br /><span>Same capability.</span></h2><EditableTaskPrompt agent="Agent 03 · Transfer" value={prompt} onChange={onPromptChange} /><PrimaryButton onClick={onCheck}>Check shared memory</PrimaryButton></div>; }
function LookupAct() { return <div className="act lookup-act"><p className="act-number">03 — TRANSFER</p><h2>Searching<br />organization memory…</h2></div>; }
function FoundAct({ capability, onRun }: { capability: SemanticCapability; onRun(): void }) { return <div className="act found-act"><p className="act-number">03 — TRANSFER</p><h2 className="single-word">Already learned.</h2><p className="capability-name">{capability.name}</p><p className="secondary">Learned by Agent 01 <span /> Shared with organization</p><PrimaryButton onClick={onRun}>Run from memory</PrimaryButton></div>; }
function CompleteAct({ prompts, runs }: { prompts: { agent1: string; agent2: string; agent3: string }; runs: { agent1: RunView; agent2: RunView; agent3: RunView } }) { return <div className="act complete-act three-agent-complete"><p className="act-number">REPLAY REMEMBERED</p><div className="hero-metrics"><p><strong>1</strong><span>workflow learned</span></p><p><strong>2</strong><span>agents reused it</span></p><p><strong>0</strong><span>LLM tokens on replay</span></p></div><p className="completion-line">Two agents reused one learned capability.</p><div className="result-columns three-columns"><RunColumn agent="Agent 01 — Learn" prompt={prompts.agent1} run={runs.agent1} /><RunColumn agent="Agent 02 — Repeat" prompt={prompts.agent2} run={runs.agent2} /><RunColumn agent="Agent 03 — Transfer" prompt={prompts.agent3} run={runs.agent3} /></div></div>; }
function RunColumn({ agent, prompt, run }: { agent: string; prompt: string; run: RunView }) { return <section className="run-column"><p className="result-agent">{agent}</p><blockquote>{prompt}</blockquote><InlineMetrics run={run} /><RepositoryList title="Results" repositories={repositoriesFrom(run.structuredResult)} /></section>; }
function InlineMetrics({ run }: { run: RunView }) { return <dl className="inline-metrics"><div><dt>Time</dt><dd>{formatMetricSeconds(run.elapsedMs)}</dd></div><div><dt>Input</dt><dd>{formatInteger(run.totalInputTokens ?? 0)}</dd></div><div><dt>Output</dt><dd>{formatInteger(run.totalOutputTokens ?? 0)}</dd></div><div><dt>LLM</dt><dd>{formatUsd(run.llmCostUsd ?? "0")}</dd></div><div><dt>Total</dt><dd>{formatUsd(run.totalCostUsd ?? "0")}</dd></div></dl>; }
function PromptQuote({ agent, prompt }: { agent: string; prompt: string }) { return <div className="prompt-quote"><p>{agent}</p><blockquote>“{prompt}”</blockquote></div>; }
function EditableTaskPrompt({ agent, value, onChange }: { agent: string; value: string; onChange(value: string): void }) { const textarea = useRef<HTMLTextAreaElement>(null); useEffect(() => { if (!textarea.current) return; textarea.current.style.height = "0px"; textarea.current.style.height = `${textarea.current.scrollHeight}px`; }, [value]); return <label className="task-prompt"><span className="prompt-label"><strong>{agent}</strong><em>Edit prompt</em></span><textarea ref={textarea} aria-label={`${agent} task`} rows={2} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function RepositoryList({ title, repositories, compact = false }: { title: string; repositories: GitHubRepositoryResearchResult["repositories"]; compact?: boolean }) { return <section className={`repo-list${compact ? " compact" : ""}`}><h3>{title}</h3>{repositories.map((repo) => <a href={repo.url} key={repo.url} rel="noreferrer" target="_blank"><span><strong>{repo.owner}/{repo.name}</strong><small>{repo.description}</small></span><em>{formatStars(repo.stars)} ★</em></a>)}</section>; }
function MemoryPopover({ capability, clearing, onClear }: { capability: SemanticCapability; clearing: boolean; onClear(): void }) { return <aside className="memory-popover"><strong>{capability.name}</strong><span>Learned by Agent 01</span><span className="accent">Deterministic</span><span>{capability.deterministicUses} successful reuses</span><button disabled={clearing} onClick={onClear} type="button">{clearing ? "Clearing…" : "Clear memory & workspace"}</button></aside>; }
function ErrorAct({ error, onReset }: { error: string | null; onReset(): void }) { return <div className="act error-act"><p className="act-number">RUN NEEDS ATTENTION</p><h2>Nothing was published.</h2><p>The operation could not be completed. Existing organization memory remains unchanged.</p>{error && <details><summary>Technical details</summary><code>{error}</code></details>}<PrimaryButton onClick={onReset}>Return to workspace</PrimaryButton></div>; }
function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick(): void }) { return <button className="primary-button" onClick={onClick} type="button">{children}<span>→</span></button>; }
function TextButton({ children, onClick }: { children: React.ReactNode; onClick(): void }) { return <button className="text-button" onClick={onClick} type="button">{children} <span>→</span></button>; }
function finiteNumber(value: number, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function formatSeconds(ms: number) { return `${(finiteNumber(ms) / 1000).toFixed(1)}s`; }
function formatMetricSeconds(ms: number) { return `${(finiteNumber(ms) / 1000).toFixed(3)}s`; }
function formatInteger(value: number) { return new Intl.NumberFormat("en-US").format(finiteNumber(value)); }
function formatUsd(value: string) { const amount = Number(value); return `$${finiteNumber(amount).toFixed(amount === 0 ? 0 : 6)}`; }
function formatStars(value: number) { return `${(value / 1000).toFixed(1)}k`; }
