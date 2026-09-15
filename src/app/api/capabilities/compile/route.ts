import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CapabilityCompilationError,
  compileStoredDiscoveryRun,
} from "@/lib/capabilities/compiler";
import { capabilityRegistry } from "@/lib/capabilities/registry";

const compileRequestSchema = z.object({
  runId: z.string().min(1),
  learnedByAgentId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = compileRequestSchema.parse(await request.json());
    const capability = compileStoredDiscoveryRun(input);
    return NextResponse.json({ capability: capabilityRegistry.addCapability(capability) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof CapabilityCompilationError ? 422 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
