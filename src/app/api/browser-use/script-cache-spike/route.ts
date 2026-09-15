import { NextResponse } from "next/server";
import { runScriptCacheSpike } from "@/lib/browser-use/script-cache-spike";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const result = await runScriptCacheSpike();
  const failed = result.error !== null || result.runs.some((run) => run.error !== null);
  return NextResponse.json(result, { status: failed ? 502 : 200 });
}
