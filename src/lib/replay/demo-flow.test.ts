import { describe, expect, it } from "vitest";
import {
  createInitialDemoPrompts,
  DEFAULT_AGENT_1_PROMPT,
  DEFAULT_AGENT_3_PROMPT,
  snapshotRepeatPrompt,
} from "./demo-flow";

describe("three-agent demo flow", () => {
  it("snapshots Agent 01's exact submitted prompt for Agent 02", () => {
    const prompt = "Find 4 GitHub repos about browser agents above 2,000 stars";
    expect(snapshotRepeatPrompt(prompt)).toBe(prompt);
  });

  it("restores repeat and transfer defaults independently", () => {
    expect(createInitialDemoPrompts()).toEqual({
      agent1: DEFAULT_AGENT_1_PROMPT,
      agent2: DEFAULT_AGENT_1_PROMPT,
      agent3: DEFAULT_AGENT_3_PROMPT,
    });
  });
});
