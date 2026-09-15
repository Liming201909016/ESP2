import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { approvalRecordSchema } from "./approval-contracts";
import { ticketReceiptSchema } from "./contracts";
import { inPostgresTransaction, postgresSql, type StateSql } from "./postgres";
import { createStateSchema, stateSchemaVersion } from "./postgres-schema";
import { postgresStateStore } from "./postgres-state";
import { stateBackend, stateWritesPaused } from "./state-config";
import { readBlobStateSnapshot, type StateSnapshot } from "./state-migration-source";

export const stateMigrationReportSchema = z.object({
  id: z.uuid(), schemaVersion: z.literal(1), source: z.literal("blob"), target: z.literal("postgres"), completedAt: z.iso.datetime(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/), tickets: z.number().int().nonnegative(), approvals: z.number().int().nonnegative(),
  insertedTickets: z.number().int().nonnegative(), insertedApprovals: z.number().int().nonnegative(), skippedUnownedTickets: z.number().int().nonnegative(),
});
export type StateMigrationReport = z.infer<typeof stateMigrationReportSchema>;

function canonical(value: unknown) { return JSON.parse(JSON.stringify(value)); }

export async function copyStateSnapshot(snapshot: StateSnapshot, sql: StateSql): Promise<StateMigrationReport> {
  const version = await sql.query<{ version: number }>("SELECT version FROM esp_state.schema_versions ORDER BY version DESC LIMIT 1");
  if (version.rows[0]?.version !== stateSchemaVersion) throw new Error("STATE_SCHEMA_VERSION_UNSUPPORTED");
  const store = postgresStateStore(sql);
  const tickets = snapshot.tickets.map((ticket) => ticketReceiptSchema.parse(ticket)).sort((left, right) => left.id.localeCompare(right.id));
  const approvals = snapshot.approvals.map((approval) => approvalRecordSchema.parse(approval)).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(tickets.map((ticket) => ticket.id)).size !== tickets.length || new Set(approvals.map((approval) => approval.id)).size !== approvals.length) throw new Error("DUPLICATE_STATE_SOURCE_ID");
  const sourceDigest = createHash("sha256").update(JSON.stringify(canonical({ tickets, approvals }))).digest("hex");
  let insertedTickets = 0;
  let insertedApprovals = 0;
  for (const approval of approvals) {
    const existing = await store.getApproval(approval.id);
    if (existing) { if (!isDeepStrictEqual(canonical(existing.record), canonical(approval))) throw new Error("STATE_TARGET_APPROVAL_CONFLICT"); }
    else { await store.writeApproval(approval, null); insertedApprovals += 1; }
  }
  for (const ticket of tickets) {
    if (ticket.approvalId) {
      const approval = approvals.find((record) => record.id === ticket.approvalId);
      if (!approval || approval.createdBy !== ticket.createdBy || approval.execution?.ticketId !== ticket.id) throw new Error("STATE_SOURCE_APPROVAL_LINK_INVALID");
    }
    const existing = await store.getTicket(ticket.id, ticket.createdBy);
    if (existing) { if (!isDeepStrictEqual(canonical(existing), canonical(ticket))) throw new Error("STATE_TARGET_TICKET_CONFLICT"); }
    else { await store.saveTicket(ticket); insertedTickets += 1; }
  }
  for (const approval of approvals) {
    if (approval.status !== "completed") continue;
    const ticket = tickets.find((record) => record.id === approval.ticket?.id);
    if (!ticket || !isDeepStrictEqual(canonical(ticket), canonical(approval.ticket))) throw new Error("STATE_SOURCE_RECEIPT_MISMATCH");
  }
  const { rows } = await sql.query<{ tickets: string; approvals: string }>("SELECT (SELECT count(*)::text FROM esp_state.tickets) AS tickets, (SELECT count(*)::text FROM esp_state.approvals) AS approvals");
  if (Number(rows[0]?.tickets) !== tickets.length || Number(rows[0]?.approvals) !== approvals.length) throw new Error("STATE_TARGET_EXTRA_RECORDS");
  for (const ticket of tickets) if (!isDeepStrictEqual(canonical(await store.getTicket(ticket.id, ticket.createdBy)), canonical(ticket))) throw new Error("STATE_TICKET_VERIFICATION_FAILED");
  for (const approval of approvals) if (!isDeepStrictEqual(canonical((await store.getApproval(approval.id))?.record), canonical(approval))) throw new Error("STATE_APPROVAL_VERIFICATION_FAILED");
  await snapshot.assertUnchanged();
  const report: StateMigrationReport = {
    id: randomUUID(), schemaVersion: 1, source: "blob", target: "postgres", completedAt: new Date().toISOString(), sourceDigest,
    tickets: tickets.length, approvals: approvals.length, insertedTickets, insertedApprovals, skippedUnownedTickets: snapshot.skippedUnownedTickets,
  };
  await sql.query("INSERT INTO esp_state.migration_runs (id, source_digest, report) VALUES ($1::uuid, $2, $3::jsonb)", [report.id, sourceDigest, JSON.stringify(report)]);
  return report;
}

export async function migrateBlobState() {
  if (process.env.ESP_ENVIRONMENT !== "dev" || process.env.ESP_STATE_MIGRATE !== "blob-to-postgres" || stateBackend() !== "blob" || !stateWritesPaused()) throw new Error("STATE_MIGRATION_GUARDS_REQUIRED");
  const snapshot = await readBlobStateSnapshot();
  return inPostgresTransaction(async () => {
    await postgresSql.query("SELECT pg_advisory_xact_lock(17012026, 1)");
    await createStateSchema(postgresSql);
    return copyStateSnapshot(snapshot, postgresSql);
  });
}

export async function requirePreparedPostgres(sql: StateSql = postgresSql) {
  const { rows } = await sql.query<{ version: number }>("SELECT version FROM esp_state.schema_versions ORDER BY version DESC LIMIT 1");
  const manifest = await sql.query<{ report: unknown }>("SELECT report FROM esp_state.migration_runs ORDER BY completed_at DESC, id DESC LIMIT 1");
  if (rows[0]?.version !== stateSchemaVersion || !stateMigrationReportSchema.safeParse(manifest.rows[0]?.report).success) throw new Error("POSTGRES_STATE_NOT_PREPARED");
}