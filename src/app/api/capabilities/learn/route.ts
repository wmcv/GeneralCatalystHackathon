import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDeterministicWorkspace, createDeterministicWorkspace } from "@/lib/browser-use/workspaces";
import { runDeterministicBrowserUseV3 } from "@/lib/browser-use/deterministic-runner";
import { capabilityRegistry } from "@/lib/capabilities/registry";
import { semanticCapabilitySchema } from "@/lib/domain/capability";
import { learnDeterministicCapability } from "@/lib/replay/learn-deterministic-capability";
import { runStore } from "@/lib/state/run-store";

export const runtime = "nodejs";
export const maxDuration = 900;

const parameterSchema = z.union([z.string(), z.number(), z.boolean()]);
const requestSchema = z.object({
  capability: semanticCapabilitySchema,
  sourceParameters: z.record(z.string(), parameterSchema),
});

export async function GET() {
  return NextResponse.json({
    capabilities: capabilityRegistry.listCapabilities(),
    runs: runStore.list().map((run) => ({ ...run, result: runStore.getResult(run.id) ?? null })),
  });
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const capability = capabilityRegistry.addCapability(input.capability);
    const result = await learnDeterministicCapability(capability, input.sourceParameters, {
      registry: capabilityRegistry,
      runStore,
      createWorkspace: createDeterministicWorkspace,
      deleteWorkspace: deleteDeterministicWorkspace,
      runBrowserUseV3: runDeterministicBrowserUseV3,
    });
    return NextResponse.json(result, { status: result.deterministicReady ? 200 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
