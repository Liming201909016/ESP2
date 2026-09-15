import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuditAccessError } from "../../../lib/esp/audit-contracts";
import { auditQuerySchema, listAudit } from "../../../lib/esp/audit-store";
import { resolveIdentity } from "../../../lib/esp/identity";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = auditQuerySchema.parse({ cursor: params.get("cursor") ?? undefined, traceId: params.get("traceId") ?? undefined, reference: params.get("reference") ?? undefined });
    return NextResponse.json(await listAudit(resolveIdentity(request.headers), query), { headers });
  } catch (error) {
    if (error instanceof AuditAccessError) return NextResponse.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    console.error("audit.list.failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "AUDIT_READ_FAILED" }, { status: 502, headers });
  }
}