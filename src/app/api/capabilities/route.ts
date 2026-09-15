import { NextResponse } from "next/server";
import { capabilityRegistry } from "@/lib/capabilities/registry";

export async function GET() {
  return NextResponse.json({ capabilities: capabilityRegistry.listCapabilities() });
}
