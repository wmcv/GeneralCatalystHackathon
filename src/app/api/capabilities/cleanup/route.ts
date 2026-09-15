import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDeterministicWorkspace } from "@/lib/browser-use/workspaces";
import { capabilityRegistry } from "@/lib/capabilities/registry";
import { runStore } from "@/lib/state/run-store";

const requestSchema = z.object({
  capabilityId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
}).refine((input) => input.capabilityId || input.workspaceId, {
  message: "A capabilityId or workspaceId is required.",
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const capability = input.capabilityId
      ? capabilityRegistry.getCapabilityById(input.capabilityId)
      : undefined;
    const workspaceId = input.workspaceId ?? capability?.execution?.workspaceId;
    if (!workspaceId) {
      return NextResponse.json({ error: "Capability has no deterministic workspace." }, { status: 404 });
    }
    await deleteDeterministicWorkspace(workspaceId);
    const removedRunCount = capability ? runStore.removeByCapabilityId(capability.id) : 0;
    const capabilityRemoved = capability
      ? capabilityRegistry.removeCapability(capability.id)
      : false;
    return NextResponse.json({
      capabilityRemoved,
      removedRunCount,
      deletedWorkspaceId: workspaceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
