import { describe, expect, it } from "vitest";
import { browserMessageEvent } from "./trace";

describe("Replay trace normalization", () => {
  it("summarizes structured agent output without exposing raw JSON", () => {
    const summary = JSON.stringify({
      query: "workflow orchestration",
      repositories: [{ name: "apache/airflow" }, { name: "labring/FastGPT" }, { name: "dapr/dapr" }],
    });
    const event = browserMessageEvent("run-1", { type: "text", summary, data: summary });
    expect(event).toMatchObject({ actor: "agent", label: "Found 3 qualifying repositories" });
    expect(`${event?.label} ${event?.detail ?? ""}`).not.toContain("apache/airflow");
    expect(JSON.stringify(event?.metadata?.technicalDetails)).toContain("apache/airflow");
  });

  it.each([
    ["web_search", "Searching GitHub for browser automation", "Searching the web…"],
    ["fetch", "Fetched https://github.com/search", "Inspecting sources…"],
    ["bash", "python /workspace/scripts/research.py", "Building and testing procedure…"],
  ])("normalizes %s provider activity into a semantic event", (type, summary, label) => {
    const event = browserMessageEvent("run-1", { type, summary, data: `{\"raw\":\"${summary}\"}` });
    expect(event).toMatchObject({ actor: "agent", label });
    expect(event?.detail).toBeUndefined();
    expect(event?.metadata?.technicalDetails).toEqual({ type, summary, data: `{\"raw\":\"${summary}\"}` });
  });

  it("reserves learned-procedure language for executor activity", () => {
    const message = { type: "code_execution", summary: "Executing cached script", data: "raw" };
    expect(browserMessageEvent("run-1", message, "agent")?.label).toBe("Building and testing procedure…");
    expect(browserMessageEvent("run-2", message, "executor")?.label).toBe("Running learned procedure…");
  });
});
