import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrateReplayTask } from "@/lib/replay-layer/orchestrate";
import { acquireOperation, releaseOperation } from "@/lib/state/operation-lock";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  task: z.string().trim().min(1).max(4_000),
  agentId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const operationKey = "replay-task";
  if (!acquireOperation(operationKey)) {
    return NextResponse.json({ error: "Another task is currently running." }, { status: 409 });
  }
  try {
    const input = requestSchema.parse(await request.json());
    const result = await orchestrateReplayTask(input);
    return NextResponse.json(result, { status: result.error ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    releaseOperation(operationKey);
  }
}
