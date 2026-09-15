import { NextResponse } from "next/server";
import { z } from "zod";
import { routeCapability } from "@/lib/capabilities/router";

const routeRequestSchema = z.object({
  task: z.string().min(1),
  requestingAgentId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { task } = routeRequestSchema.parse(await request.json());
    return NextResponse.json(routeCapability(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
