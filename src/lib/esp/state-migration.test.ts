import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "./approval-contracts";
import { createStateSchema } from "./postgres-schema";
import { postgresStateStore } from "./postgres-state";
import { copyStateSnapshot, requirePreparedPostgres } from "./state-migration";
import type { StateSnapshot } from "./state-migration-source";
import type { StateSql } from "./postgres";

const database = new PGlite();
const sql: StateSql = { query: (text, values) => database.query(text, values) };
const ticket = { id: "ESP-20260911-11223344", createdBy: "development:local", createdAt: "2026-09-11T00:00:00.000Z", status: "open" as const, summary: "Legacy synthetic ticket without details" };
const approval: ApprovalRecord = {
  id: `apr-${"a".repeat(32)}`, skillId: "create-it-ticket", createdBy: "development:local", query: "Synthetic team request", requestHash: "b".repeat(64),
  parameters: { description: "Synthetic team request", impact: "team" }, policy: { policyId: "dev-ticket-impact-review", version: "1.0.0", ruleId: "team-approval", effect: "approval", reason: "Review" },
  status: "pending", createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", expiresAt: "2026-09-12T00:00:00.000Z", events: [{ action: "submitted", actor: "development:local", at: "2026-09-11T00:00:00.000Z" }],
};
const snapshot = (): StateSnapshot => ({ tickets: [ticket], approvals: [approval], skippedUnownedTickets: 1, assertUnchanged: vi.fn(async () => undefined) });
const migrate = (input: StateSnapshot) => database.transaction((transaction) => copyStateSnapshot(input, { query: (text, values) => transaction.query(text, values) }));
beforeAll(async () => { await createStateSchema(sql); }, 30_000);
beforeEach(async () => { await database.exec("TRUNCATE esp_state.tickets, esp_state.approvals, esp_state.migration_runs"); });
afterAll(async () => { await database.close(); });

describe("verified Blob state import", () => {
  it("copies complete records and records a verified manifest", async () => {
    const source = snapshot(); const report = await migrate(source);
    expect(report).toMatchObject({ tickets: 1, approvals: 1, insertedTickets: 1, insertedApprovals: 1, skippedUnownedTickets: 1 });
    expect(await postgresStateStore(sql).getTicket(ticket.id, ticket.createdBy)).toEqual(ticket);
    expect((await postgresStateStore(sql).getApproval(approval.id))?.record).toEqual(approval);
    expect(source.assertUnchanged).toHaveBeenCalledTimes(1); await expect(requirePreparedPostgres(sql)).resolves.toBeUndefined();
  });
  it("reuses identical data without overwriting or changing approval revisions", async () => {
    const first = await migrate(snapshot()); const second = await migrate(snapshot());
    expect(second.sourceDigest).toBe(first.sourceDigest); expect(second.insertedTickets).toBe(0); expect(second.insertedApprovals).toBe(0);
    expect((await postgresStateStore(sql).getApproval(approval.id))?.etag).toBe("pg:1");
  });
  it("does not commit when the source changed during the copy", async () => {
    await expect(migrate({ ...snapshot(), assertUnchanged: async () => { throw new Error("STATE_SOURCE_CHANGED"); } })).rejects.toThrow("STATE_SOURCE_CHANGED");
    expect(await postgresStateStore(sql).getApproval(approval.id)).toBeNull(); expect(await postgresStateStore(sql).listTickets(ticket.createdBy)).toEqual([]);
    expect((await sql.query("SELECT id FROM esp_state.migration_runs")).rows).toEqual([]);
  });
  it("never overwrites conflicting target records", async () => {
    await postgresStateStore(sql).saveTicket({ ...ticket, summary: "Different existing target data" });
    await expect(migrate(snapshot())).rejects.toThrow("STATE_TARGET_TICKET_CONFLICT");
    expect((await postgresStateStore(sql).getTicket(ticket.id, ticket.createdBy))?.summary).toBe("Different existing target data");
    expect(await postgresStateStore(sql).getApproval(approval.id)).toBeNull();
  });
  it("detects target records that are not represented by the source", async () => {
    await postgresStateStore(sql).saveTicket({ ...ticket, id: "ESP-20260911-55667788" });
    await expect(migrate(snapshot())).rejects.toThrow("STATE_TARGET_EXTRA_RECORDS");
    expect(await postgresStateStore(sql).getTicket(ticket.id, ticket.createdBy)).toBeNull();
  });
  it("preserves a completed approval and its linked ticket in the same commit", async () => {
    const approvedTicket = { ...ticket, summary: approval.parameters.description, details: approval.parameters, approvalId: approval.id };
    const completed: ApprovalRecord = { ...approval, status: "completed", ticket: approvedTicket, execution: { ticketId: ticket.id, createdAt: ticket.createdAt, attempts: 1 } };
    const report = await migrate({ ...snapshot(), approvals: [completed], tickets: [approvedTicket] });
    expect(report.tickets).toBe(1); expect((await postgresStateStore(sql).getApproval(approval.id))?.record.ticket).toEqual(approvedTicket);
  });
  it("rejects inconsistent or missing approval receipts", async () => {
    const approvedTicket = { ...ticket, approvalId: approval.id, details: approval.parameters };
    const completed: ApprovalRecord = { ...approval, status: "completed", ticket: approvedTicket, execution: { ticketId: ticket.id, createdAt: ticket.createdAt, attempts: 1 } };
    await expect(migrate({ ...snapshot(), approvals: [completed], tickets: [] })).rejects.toThrow("STATE_SOURCE_RECEIPT_MISMATCH");
    await expect(migrate({ ...snapshot(), approvals: [], tickets: [approvedTicket] })).rejects.toThrow("STATE_SOURCE_APPROVAL_LINK_INVALID");
  });
  it("does not consider an empty schema a completed migration", async () => {
    await expect(requirePreparedPostgres(sql)).rejects.toThrow("POSTGRES_STATE_NOT_PREPARED");
  });
  it("rejects an unsupported target schema before copying records", async () => {
    await sql.query("INSERT INTO esp_state.schema_versions (version) VALUES (2)");
    try {
      await expect(migrate(snapshot())).rejects.toThrow("STATE_SCHEMA_VERSION_UNSUPPORTED");
      expect(await postgresStateStore(sql).listTickets(ticket.createdBy)).toEqual([]);
    } finally { await sql.query("DELETE FROM esp_state.schema_versions WHERE version = 2"); }
  });
});