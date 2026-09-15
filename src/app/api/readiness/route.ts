import { NextResponse } from "next/server";
import { dependencyReadiness } from "../../../lib/esp/readiness-probes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await dependencyReadiness();
  return NextResponse.json(result, { status: result.status === "ready" ? 200 : 503, headers: { "Cache-Control": "private, no-store" } });
}