import { NextResponse } from "next/server";
import { resolveIdentity } from "../../../lib/esp/identity";
import { getSkillCatalog } from "../../../lib/esp/skill-catalog";
import { getEvaluationRuntime } from "../../../lib/esp/evaluation-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = resolveIdentity(request.headers);
  const headers = { "Cache-Control": "private, no-store" };
  if (!identity.authenticated) {
    return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  }

  return NextResponse.json({
    runtime: {
      environment: ["dev", "test", "production"].includes(process.env.ESP_ENVIRONMENT ?? "") ? process.env.ESP_ENVIRONMENT : process.env.NODE_ENV === "development" ? "dev" : "unknown",
      identity: { displayName: identity.displayName?.slice(0, 120) ?? null, source: identity.source },
    },
    skills: getSkillCatalog(identity.permissions),
    evaluationRuntime: await getEvaluationRuntime(identity.permissions),
    generatedAt: new Date().toISOString(),
  }, { headers });
}