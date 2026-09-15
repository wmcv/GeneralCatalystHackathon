import "server-only";

import { BrowserUse } from "browser-use-sdk/v3";
import { getBrowserUseEnv } from "./config";

function client(): BrowserUse {
  const { BROWSER_USE_API_KEY } = getBrowserUseEnv();
  return new BrowserUse({ apiKey: BROWSER_USE_API_KEY, maxRetries: 0 });
}

export async function createDeterministicWorkspace(name: string): Promise<{ id: string }> {
  const workspace = await client().workspaces.create({ name });
  return { id: workspace.id };
}

export async function deleteDeterministicWorkspace(workspaceId: string): Promise<void> {
  await client().workspaces.delete(workspaceId);
}
