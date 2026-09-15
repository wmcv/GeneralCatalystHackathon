import { NextResponse } from "next/server";
import { z } from "zod";
import { runDeterministicBrowserUseV3 } from "@/lib/browser-use/deterministic-runner";
import { capabilityRegistry } from "@/lib/capabilities/registry";
import { executeRoutedDeterministicCapability } from "@/lib/replay/deterministic-executor";
import { runStore } from "@/lib/state/run-store";
import { acquireOperation, releaseOperation } from "@/lib/state/operation-lock";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  task: z.string().min(1),
  requestingAgentId: z.string().min(1),
});

export async function POST(request: Request) {
  const operationKey = "github-deterministic-replay";
  if (!acquireOperation(operationKey)) {
    return NextResponse.json(
      { error: "Deterministic replay is already in progress." },
      { status: 409 },
    );
  }
  try {
    const input = requestSchema.parse(await request.json());
    const result = await executeRoutedDeterministicCapability(input, {
      registry: capabilityRegistry,
      runStore,
      runBrowserUseV3: runDeterministicBrowserUseV3,
    });
    return NextResponse.json(result, { status: result.deterministicSuccess ? 200 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    releaseOperation(operationKey);
  }
}
