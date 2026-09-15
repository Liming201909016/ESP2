import { NextResponse } from "next/server";
import { resolveIdentity } from "../../../lib/esp/identity";
import { listTickets } from "../../../lib/esp/ticket-store";
import { auditedResponse } from "../../../lib/esp/audit-http";
import { stateBackend, stateWritesPaused } from "../../../lib/esp/state-config";

export async function GET(request: Request) {
  const identity = resolveIdentity(request.headers);
  return auditedResponse(request, { identity, kind: "ticket_read", action: "tickets.list", mutation: false, requiredPermissions: ["tickets.read"] }, async () => {
  if (!identity.authenticated) {
    return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }
  if (!identity.permissions.includes("tickets.read")) {
    return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 403 });
  }
  if (!identity.subject) {
    return NextResponse.json({ error: "IDENTITY_SUBJECT_REQUIRED" }, { status: 403 });
  }

  try {
    return NextResponse.json({ tickets: await listTickets(identity.subject, 50), state: { backend: stateBackend(), writesPaused: stateWritesPaused() } });
  } catch (error) {
    console.error("Ticket listing failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "TICKET_LIST_FAILED" }, { status: 502 });
  }
  });
}