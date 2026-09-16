import { NextResponse } from "next/server";
import { resolveIdentity } from "../../../lib/esp/identity";
import {
  executeGovernance,
  governanceCatalog,
  GovernanceError,
  requireGovernanceIdentity,
} from "../../../lib/esp/governance";
import { AuditStartError } from "../../../lib/esp/audit-contracts";
import { knowledgeJson, KnowledgeRequestError } from "../../../lib/esp/knowledge-api";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof AuditStartError)
    return NextResponse.json({ error: "AUDIT_START_FAILED", audit: error.receipt }, { status: 503, headers });
  if (error instanceof GovernanceError || error instanceof KnowledgeRequestError)
    return NextResponse.json({ error: error.code }, { status: error.status, headers });
  return NextResponse.json({ error: "GOVERNANCE_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    return NextResponse.json(await governanceCatalog(resolveIdentity(request.headers)), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const identity = resolveIdentity(request.headers);
    requireGovernanceIdentity(identity);
    const result = await executeGovernance(await knowledgeJson(request), identity);
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    return failure(error);
  }
}
