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
    expect(JSON.stringify(event)).not.toContain("apache/airflow");
  });
});
