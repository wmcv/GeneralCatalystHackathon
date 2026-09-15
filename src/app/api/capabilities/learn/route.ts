import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDeterministicWorkspace, createDeterministicWorkspace } from "@/lib/browser-use/workspaces";
import { runDeterministicBrowserUseV3 } from "@/lib/browser-use/deterministic-runner";
import {
  containsGeneratedScript,
  getBrowserUseV3SessionMessages,
} from "@/lib/browser-use/deterministic-runner";
import { capabilityRegistry } from "@/lib/capabilities/registry";
import { semanticCapabilitySchema } from "@/lib/domain/capability";
import {
  confirmDeterministicLearning,
  learnDeterministicCapability,
} from "@/lib/replay/learn-deterministic-capability";
import { runStore } from "@/lib/state/run-store";
import { acquireOperation, releaseOperation } from "@/lib/state/operation-lock";

export const runtime = "nodejs";
export const maxDuration = 900;

const parameterSchema = z.union([z.string(), z.number(), z.boolean()]);
const requestSchema = z.object({
  capability: semanticCapabilitySchema,
  sourceParameters: z.record(z.string(), parameterSchema),
});

const confirmRequestSchema = z.object({
  capabilityId: z.string().min(1),
  sessionId: z.string().min(1),
});

export async function GET() {
  return NextResponse.json({
    capabilities: capabilityRegistry.listCapabilities(),
    runs: runStore.list().map((run) => ({ ...run, result: runStore.getResult(run.id) ?? null })),
  });
}

export async function PATCH(request: Request) {
  try {
    const input = confirmRequestSchema.parse(await request.json());
    const capability = await confirmDeterministicLearning(input.capabilityId, input.sessionId, {
      registry: capabilityRegistry,
      runStore,
      getSessionMessages: getBrowserUseV3SessionMessages,
      containsGeneratedScript,
    });
    return NextResponse.json({ capability });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function POST(request: Request) {
  const operationKey = "github-capability-learning";
  if (!acquireOperation(operationKey)) {
    return NextResponse.json(
      { error: "Capability learning is already in progress." },
      { status: 409 },
    );
  }
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
  } finally {
    releaseOperation(operationKey);
  }
}
