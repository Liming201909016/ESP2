import { NextResponse } from "next/server";
import { resolveIdentity } from "../../../lib/esp/identity";
import { getPluginCatalog } from "../../../lib/esp/plugin-catalog";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const identity = resolveIdentity(request.headers);
  if (!identity.authenticated) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  return NextResponse.json({ plugins: getPluginCatalog(identity.permissions), generatedAt: new Date().toISOString() }, { headers });
}