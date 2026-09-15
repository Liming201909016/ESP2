import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalRecord } from "./approval-contracts";
import type { StateSql } from "./postgres";
import { createStateSchema } from "./postgres-schema";
import { postgresStateStore } from "./postgres-state";

const database = new PGlite();
const sql: StateSql = { query: (text, values) => database.query(text, values) };
const store = postgresStateStore(sql);
const approval: ApprovalRecord = {
  id: `apr-${"a".repeat(32)}`, skillId: "create-it-ticket", createdBy: "owner-one", query: "Simulated team issue",
  parameters: { description: "Simulated team issue", impact: "team" }, requestHash: "b".repeat(64),
  policy: { policyId: "dev-ticket-impact-review", version: "1.0.0", ruleId: "team-approval", effect: "approval", reason: "Review" },
  status: "pending", createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", expiresAt: "2026-09-12T00:00:00.000Z",
  events: [{ action: "submitted", actor: "owner-one", at: "2026-09-11T00:00:00.000Z" }],
};
const ticket = { id: "ESP-20260911-AABB0011", createdBy: "owner-one", createdAt: "2026-09-11T00:00:00.000Z", status: "open" as const, summary: "Synthetic issue", details: { description: "Synthetic issue", impact: "individual" as const } };

beforeAll(async () => { await createStateSchema(sql); }, 30_000);
beforeEach(async () => { await database.exec("TRUNCATE esp_state.tickets, esp_state.approvals"); });
afterAll(async () => { await database.close(); });

describe("PostgreSQL transaction state", () => {
  it("applies the schema idempotently", async () => {
    await createStateSchema(sql);
    expect((await sql.query("SELECT version FROM esp_state.schema_versions")).rows).toEqual([{ version: 1 }]);
  });
  it("preserves ticket data and filters every read by its owner", async () => {
    await store.saveTicket(ticket);
    expect(await store.getTicket(ticket.id, ticket.createdBy)).toEqual(ticket);
    expect(await store.getTicket(ticket.id, "other-owner")).toBeNull();
    expect(await store.listTickets("other-owner")).toEqual([]);
  });
  it("accepts identical ticket retries but never overwrites different data or owners", async () => {
    await store.saveTicket(ticket); await store.saveTicket({ ...ticket, details: { ...ticket.details, device: undefined } });
    await expect(store.saveTicket({ ...ticket, summary: "Changed" })).rejects.toThrow("TICKET_CONFLICT");
    await expect(store.saveTicket({ ...ticket, createdBy: "other-owner" })).rejects.toThrow("TICKET_CONFLICT");
    expect(await store.getTicket(ticket.id, ticket.createdBy)).toEqual(ticket);
  });
  it("requires an existing approval and permits only one ticket per approval", async () => {
    const approvedTicket = { ...ticket, approvalId: approval.id };
    await expect(store.saveTicket(approvedTicket)).rejects.toThrow();
    await store.writeApproval(approval, null);
    await expect(store.saveTicket({ ...approvedTicket, createdBy: "other-owner" })).rejects.toThrow();
    await store.saveTicket(approvedTicket);
    await expect(store.saveTicket({ ...approvedTicket, id: "ESP-20260911-AABB0022" })).rejects.toThrow("APPROVAL_TICKET_CONFLICT");
  });
  it("persists one receipt when identical individual writes arrive concurrently", async () => {
    await Promise.all(Array.from({ length: 8 }, () => store.saveTicket(ticket)));
    expect(await store.listTickets(ticket.createdBy)).toEqual([ticket]);
  });
  it("guards approval changes with revisions and immutable ownership", async () => {
    const pending = await store.writeApproval(approval, null);
    expect(pending.etag).toBe("pg:1"); expect(pending.record).toEqual(approval);
    const approved = await store.writeApproval({ ...approval, status: "approved" }, pending.etag);
    expect(approved.etag).toBe("pg:2");
    await expect(store.writeApproval({ ...approval, status: "rejected" }, pending.etag)).rejects.toThrow("CONFLICT");
    await expect(store.writeApproval({ ...approval, createdBy: "other" }, approved.etag)).rejects.toThrow("CONFLICT");
    await expect(store.writeApproval(approval, null)).rejects.toThrow("CONFLICT");
    await expect(store.writeApproval(approval, '"old-blob-etag"')).rejects.toThrow("CONFLICT");
  });
  it("orders owner-scoped approvals newest first with stable keyset pagination", async () => {
    for (let index = 1; index <= 23; index += 1) await store.writeApproval({ ...approval, id: `apr-${index.toString(16).padStart(32, "0")}` }, null);
    await store.writeApproval({ ...approval, id: `apr-${"f".repeat(32)}`, createdBy: "other-owner" }, null);
    const first = await store.listApprovals("owner-one"); const second = await store.listApprovals("owner-one", first.nextCursor!);
    expect(first.approvals).toHaveLength(20); expect(second.approvals).toHaveLength(3); expect(second.nextCursor).toBeNull();
    const ids = [...first.approvals, ...second.approvals].map((entry) => entry.record.id);
    expect(ids).toEqual([...ids].sort().reverse()); expect(new Set(ids).size).toBe(23);
    await expect(store.listApprovals("owner-one", "old-blob-cursor")).rejects.toThrow("INVALID_CURSOR");
  });
  it("returns the newest requested tickets without a global Blob scan limit", async () => {
    await store.saveTicket(ticket);
    await store.saveTicket({ ...ticket, id: "ESP-20260911-AABB0022", createdAt: "2026-09-11T02:00:00.000Z" });
    expect((await store.listTickets("owner-one", 1)).map((record) => record.id)).toEqual(["ESP-20260911-AABB0022"]);
  });
  it("uses SQL parameters for values that contain SQL-like text", async () => {
    const malicious = { ...ticket, summary: "Robert'); DROP TABLE esp_state.tickets; --" };
    await store.saveTicket(malicious);
    expect((await store.getTicket(ticket.id, ticket.createdBy))?.summary).toBe(malicious.summary);
    expect(await store.getTicket(ticket.id, "owner-one' OR TRUE --")).toBeNull();
  });
  it("rolls back related approval and ticket writes as one transaction", async () => {
    await store.writeApproval(approval, null);
    await expect(database.transaction(async (transaction) => {
      const transactional = postgresStateStore({ query: (text, values) => transaction.query(text, values) });
      await transactional.writeApproval({ ...approval, status: "approved" }, "pg:1");
      await transactional.saveTicket({ ...ticket, approvalId: approval.id });
      throw new Error("Injected final write failure");
    })).rejects.toThrow("Injected final write failure");
    expect((await store.getApproval(approval.id))?.record.status).toBe("pending");
    expect(await store.getTicket(ticket.id, ticket.createdBy)).toBeNull();
  });
});