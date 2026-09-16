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
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const operationKey = "replay-task";
  if (!acquireOperation(operationKey)) {
    return NextResponse.json({ error: "Another task is currently running." }, { status: 409 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      void orchestrateReplayTask(input, undefined, (event) => send({ type: "trace", event }))
        .then((result) => send({ type: "result", result }))
        .catch((error: unknown) => send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }))
        .finally(() => {
          releaseOperation(operationKey);
          controller.close();
        });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
