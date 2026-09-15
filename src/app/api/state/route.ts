import { NextResponse } from "next/server";
import { ApprovalError } from "../../../lib/esp/approval-contracts";
import { canReviewApprovals, requireApprovalIdentity } from "../../../lib/esp/approval-workflow";
import { resolveIdentity } from "../../../lib/esp/identity";
import { PostgresStateError } from "../../../lib/esp/postgres";
import { PostgresSecretError } from "../../../lib/esp/postgres-secret";
import { stateBackend, stateWritesPaused } from "../../../lib/esp/state-config";
import { postgresStateStatus } from "../../../lib/esp/state-status";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const identity = resolveIdentity(request.headers);
    const owner = requireApprovalIdentity(identity);
    const target = new URL(request.url).searchParams.get("target");
    if (target && target !== "postgres") throw new ApprovalError("INVALID_REQUEST", 400);
    if (target && !canReviewApprovals(identity)) throw new ApprovalError("DEV_MANAGEMENT_REQUIRED", 403);
    const backend = stateBackend();
    const postgres = backend === "postgres" || target === "postgres" ? await postgresStateStatus(owner) : null;
    if (postgres && !canReviewApprovals(identity)) postgres.lastMigration = null;
    return NextResponse.json({ backend, writesPaused: stateWritesPaused(), postgres }, { headers });
  } catch (error) {
    if (error instanceof ApprovalError) return NextResponse.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof PostgresSecretError) return NextResponse.json({ error: error.code, secretStatus: error.statusCode }, { status: 502, headers });
    const configuration = error instanceof Error && /^POSTGRES_CONFIGURATION_INVALID:[a-z,]+$/.test(error.message) ? error.message.split(":")[1].split(",") : undefined;
    console.error("state.status.failed", { name: error instanceof Error ? error.name : "UnknownError", sqlState: error instanceof PostgresStateError ? error.sqlState : undefined, connectionCode: error instanceof PostgresStateError ? error.connectionCode : undefined, configuration });
    return NextResponse.json({ error: "STATE_STATUS_UNAVAILABLE", configuration, sqlState: error instanceof PostgresStateError ? error.sqlState : undefined, connectionCode: error instanceof PostgresStateError ? error.connectionCode : undefined }, { status: 502, headers });
  }
}