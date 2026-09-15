import { NextResponse } from "next/server";
import { runBrowserUseSpike } from "@/lib/browser-use/client";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST() {
  const result = await runBrowserUseSpike();
  return NextResponse.json(result, { status: result.error ? 502 : 200 });
}
