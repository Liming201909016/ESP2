import { NextResponse } from "next/server";
import { knowledgeIdentity, knowledgeJson } from "../../../../lib/esp/knowledge-api";
import { auditedResponse } from "../../../../lib/esp/audit-http";
import { resolveIdentity } from "../../../../lib/esp/identity";
import { diagnoseSimulation, diagnosticRequestSchema } from "../../../../lib/esp/simulation-diagnostics";

export async function POST(request: Request) {
  if (process.env.ESP_SIMULATION_DIAGNOSTICS !== "true") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  try { knowledgeIdentity(request, true); }
  catch { return NextResponse.json({ error: "DIAGNOSTIC_ACCESS_DENIED" }, { status: 403 }); }
  let input;
  try { input = diagnosticRequestSchema.parse(await knowledgeJson(request)); }
  catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  return auditedResponse(request, { identity: resolveIdentity(request.headers), kind: "skill_request", action: "simulation.diagnostic", mutation: false, requiredPermissions: ["knowledge.read"] }, async () => {
    try { return NextResponse.json({ diagnostic: await diagnoseSimulation(input) }); }
    catch { return NextResponse.json({ error: "UNKNOWN_SIMULATION_CASE" }, { status: 400 }); }
  });
}