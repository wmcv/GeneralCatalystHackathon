export const DEFAULT_AGENT_1_PROMPT =
  "Find 3 GitHub repositories for browser automation with over 1,000 stars.";
export const DEFAULT_AGENT_3_PROMPT =
  "Find 3 GitHub repositories for workflow orchestration with over 1,500 stars.";

export interface DemoPrompts {
  agent1: string;
  agent2: string;
  agent3: string;
}

export function createInitialDemoPrompts(): DemoPrompts {
  return {
    agent1: DEFAULT_AGENT_1_PROMPT,
    agent2: DEFAULT_AGENT_1_PROMPT,
    agent3: DEFAULT_AGENT_3_PROMPT,
  };
}

export function snapshotRepeatPrompt(agent1Prompt: string): string {
  return agent1Prompt;
}
