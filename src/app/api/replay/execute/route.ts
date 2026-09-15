import { NextResponse } from "next/server";
import { z } from "zod";
import { capabilityRegistry } from "@/lib/capabilities/registry";
import { runBrowserUseExecution } from "@/lib/replay/browser-use-runner";
import { executeCapability } from "@/lib/replay/execute-capability";
import { runStore } from "@/lib/state/run-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  task: z.string().min(1),
  requestingAgentId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const result = await executeCapability(input, {
      registry: capabilityRegistry,
      runStore,
      runBrowserTask: runBrowserUseExecution,
    });
    return NextResponse.json(result, { status: result.matched ? 200 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
