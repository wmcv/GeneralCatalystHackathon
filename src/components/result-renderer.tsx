import { githubRepositoryIdentifier } from "@/lib/browser-use/github-types";
import type { CompositionOutput } from "@/lib/replay-layer/compose";

type LinkItem = { title: string; url: string; description?: string; meta?: string };

function githubItems(value: unknown): LinkItem[] | null {
  if (!value || typeof value !== "object" || !("repositories" in value) || !Array.isArray(value.repositories)) return null;
  return value.repositories.map((item) => { const repo = item as { name: string; owner?: string; fullName?: string; url: string; description?: string; stars?: number }; return { title: githubRepositoryIdentifier(repo), url: String(repo.url), description: String(repo.description ?? ""), meta: `${Number(repo.stars ?? 0).toLocaleString()} ★` }; });
}

function genericLinks(value: unknown): LinkItem[] | null {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value).find(Array.isArray) : null;
  if (!Array.isArray(list)) return null;
  const items = list.filter((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string");
  if (!items.length) return null;
  return items.map((item) => { const record = item as Record<string, unknown>; return { title: String(record.name ?? record.title ?? record.url), url: String(record.url), description: typeof record.description === "string" ? record.description : undefined }; });
}

function Composition({ value }: { value: CompositionOutput }) {
  return <section className="comparison-result"><p className="result-label">{value.title}</p><p>{value.summary}</p><div>{value.sections.map((section, index) => <section key={`${section.heading}-${index}`}><h3>{section.heading}</h3><p>{section.body}</p></section>)}</div>{value.recommendation && <p className="comparison-recommendation"><strong>Best suited for</strong>{value.recommendation}</p>}</section>;
}

export function ResultRenderer({ value }: { value: unknown }) {
  if (value && typeof value === "object" && "capabilityResult" in value && "transformation" in value) {
    const composed = value as { capabilityResult: unknown; transformation: CompositionOutput };
    return <><ResultRenderer value={composed.capabilityResult} /><Composition value={composed.transformation} /></>;
  }
  const links = githubItems(value) ?? genericLinks(value);
  if (links) return <section className="result-view"><p className="result-label">RESULT</p><div className="result-links">{links.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url}><span><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</span>{item.meta && <em>{item.meta}</em>}</a>)}</div></section>;
  if (value && typeof value === "object" && !Array.isArray(value)) return <section className="result-view"><p className="result-label">RESULT</p><dl className="key-value-result">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof item === "object" ? JSON.stringify(item) : String(item)}</dd></div>)}</dl></section>;
  return <section className="result-view"><p className="result-label">RESULT</p><pre>{JSON.stringify(value, null, 2)}</pre></section>;
}
