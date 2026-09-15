import { NextResponse } from "next/server";
import { AuditAccessError } from "../../../../lib/esp/audit-contracts";
import { getAudit } from "../../../../lib/esp/audit-store";
import { resolveIdentity } from "../../../../lib/esp/identity";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ auditId: string }> }) {
  try {
    const record = await getAudit((await context.params).auditId, resolveIdentity(request.headers));
    if (!record) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers });
    return NextResponse.json(record, { headers });
  } catch (error) {
    if (error instanceof AuditAccessError) return NextResponse.json({ error: error.code }, { status: error.status, headers });
    console.error("audit.detail.failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "AUDIT_READ_FAILED" }, { status: 502, headers });
  }
}