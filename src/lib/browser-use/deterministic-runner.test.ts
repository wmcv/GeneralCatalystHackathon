import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  run: vi.fn(),
  BrowserUse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("browser-use-sdk/v3", () => ({ BrowserUse: mocks.BrowserUse }));

import { containsGeneratedScript, runDeterministicBrowserUseV3 } from "./deterministic-runner";

const execution = {
  provider: "browser-use-v3" as const,
  mode: "cached-script" as const,
  workspaceId: "workspace-1",
  taskTemplate: "Lookup @{{query}}",
  cacheScript: true as const,
  autoHeal: false as const,
  deterministicReady: true,
};

function fakeRun(shouldFail = false) {
  const result = {
    id: "session-1",
    status: "stopped",
    model: "gpt-5.6-luna",
    output: null,
    stepCount: 1,
    isTaskSuccessful: false,
    recordingUrls: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    proxyUsedMb: "0",
    llmCostUsd: "0",
    proxyCostUsd: "0",
    browserCostUsd: "0",
    totalCostUsd: "0",
    createdAt: "2026-09-15T16:00:00.000Z",
    updatedAt: "2026-09-15T16:00:01.000Z",
  };
  return {
    sessionId: "session-1",
    result,
    async *[Symbol.asyncIterator]() {
      if (shouldFail) throw new Error("run failed");
    },
  };
}

describe("Browser Use V3 deterministic runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BROWSER_USE_API_KEY = "test-key";
    mocks.stop.mockResolvedValue({});
    mocks.BrowserUse.mockImplementation(function MockBrowserUse() {
      return {
        run: mocks.run,
        sessions: { stop: mocks.stop },
      };
    });
  });

  it("disables retries and auto-healing and stops a successful session", async () => {
    mocks.run.mockReturnValue(fakeRun());
    await runDeterministicBrowserUseV3(execution, "Lookup @{{value}}");
    expect(mocks.BrowserUse).toHaveBeenCalledWith({ apiKey: "test-key", maxRetries: 0 });
    expect(mocks.run.mock.calls[0][1]).toMatchObject({
      workspaceId: "workspace-1",
      cacheScript: true,
      autoHeal: false,
    });
    expect(mocks.stop).toHaveBeenCalledWith("session-1", { strategy: "session" });
  });

  it("stops the session when execution fails", async () => {
    mocks.run.mockReturnValue(fakeRun(true));
    const result = await runDeterministicBrowserUseV3(execution, "Lookup @{{value}}");
    expect(result.error).toBe("run failed");
    expect(mocks.stop).toHaveBeenCalledWith("session-1", { strategy: "session" });
  });

  it("detects generated scripts exposed in a message summary", () => {
    expect(containsGeneratedScript([{
      type: "code_execution",
      summary: "Running: python /workspace/scripts/cached.py",
      data: "{}",
    }])).toBe(true);
  });
});
