import { NextResponse } from "next/server";
import { z } from "zod";
import { routeCapability } from "@/lib/capabilities/router";
import { createInMemoryCapabilityRegistry } from "@/lib/capabilities/registry";
import { semanticCapabilitySchema } from "@/lib/domain/capability";

const routeRequestSchema = z.object({
  task: z.string().min(1),
  requestingAgentId: z.string().min(1),
  capability: semanticCapabilitySchema.optional(),
});

export async function POST(request: Request) {
  try {
    const { task, capability } = routeRequestSchema.parse(await request.json());
    const registry = capability
      ? createInMemoryCapabilityRegistry(new Map([[capability.id, capability]]))
      : undefined;
    return NextResponse.json(routeCapability(task, registry));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
