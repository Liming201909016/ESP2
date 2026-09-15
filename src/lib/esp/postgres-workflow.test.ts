import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStateSchema } from "./postgres-schema";
import { withPostgresExecutor, type StateSql } from "./postgres";
import { changeApproval, submitApproval } from "./approval-workflow";
import { getApproval, writeApproval } from "./approval-store";
import { getTicket, listTickets, saveTicket } from "./ticket-store";
import type { IdentityContext } from "./identity";

const database = new PGlite();
const sql: StateSql = { query: (text, values) => database.query(text, values) };
const identity: IdentityContext = { authenticated: true, subject: "development:local", displayName: "DEV", permissions: ["tickets.create", "tickets.read"], source: "development" };
const parameters = { description: "Synthetic PostgreSQL team failure", impact: "team" as const };
function run<Result>(work: () => Promise<Result>) { return database.transaction((transaction) => withPostgresExecutor({ query: (text, values) => transaction.query(text, values) }, work)); }
function submit() { return run(() => submitApproval("Synthetic PostgreSQL ticket", parameters, "ab125952-530a-4e73-928f-1f1b420a645f", identity)); }

beforeAll(async () => { await createStateSchema(sql); }, 30_000);
beforeEach(async () => {
  await database.exec("TRUNCATE esp_state.tickets, esp_state.approvals");
  vi.stubEnv("ESP_STATE_BACKEND", "postgres"); vi.stubEnv("ESP_STATE_WRITES_PAUSED", "false");
  vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await database.close(); });

describe("PostgreSQL-backed approval workflow", () => {
  it("uses existing repositories and plugin execution with one atomic receipt", async () => {
    const pending = await submit();
    expect(await submit()).toEqual(pending);
    const approved = await run(() => changeApproval(pending.record.id, { action: "approve", etag: pending.etag }, identity));
    const completed = await run(() => changeApproval(pending.record.id, { action: "execute", etag: approved.etag }, identity));
    expect(completed.record.status).toBe("completed");
    expect(completed.record.ticket?.details).toEqual(parameters);
    expect(await run(() => getTicket(completed.record.ticket!.id, identity.subject!))).toEqual(completed.record.ticket);
    expect(await run(() => changeApproval(pending.record.id, { action: "execute", etag: approved.etag }, identity))).toEqual(completed);
    expect(await run(() => listTickets(identity.subject!))).toHaveLength(1);
  });
  it("rolls back the ticket insert if final approval persistence fails", async () => {
    const pending = await submit();
    const approved = await run(() => changeApproval(pending.record.id, { action: "approve", etag: pending.etag }, identity));
    await expect(run(() => changeApproval(pending.record.id, { action: "execute", etag: approved.etag }, identity, {
      write: async (record, etag) => { if (record.status === "completed") throw new Error("Injected final state failure"); return writeApproval(record, etag); },
    }))).rejects.toThrow("Injected final state failure");
    expect((await run(() => getApproval(pending.record.id)))?.record.status).toBe("approved");
    expect(await run(() => listTickets(identity.subject!))).toEqual([]);
    const recovered = await run(() => changeApproval(pending.record.id, { action: "execute", etag: approved.etag }, identity));
    expect(recovered.record.status).toBe("completed"); expect(recovered.record.execution?.attempts).toBe(1);
  });
  it("does not expose or mutate another owner's approval", async () => {
    const pending = await submit();
    await expect(run(() => changeApproval(pending.record.id, { action: "approve", etag: pending.etag }, { ...identity, subject: "other" }))).rejects.toThrow("NOT_FOUND");
    expect(await run(() => listTickets("other"))).toEqual([]);
  });
  it("keeps explicit write maintenance separate from reads", async () => {
    const pending = await submit(); vi.stubEnv("ESP_STATE_WRITES_PAUSED", "true");
    expect((await run(() => getApproval(pending.record.id)))?.record.id).toBe(pending.record.id);
    await expect(submit()).rejects.toThrow("STATE_WRITES_PAUSED");
    await expect(run(() => changeApproval(pending.record.id, { action: "approve", etag: pending.etag }, identity))).rejects.toThrow("STATE_WRITES_PAUSED");
    await expect(run(() => saveTicket({ id: "ESP-20260911-11223344", createdBy: identity.subject!, createdAt: "2026-09-11T00:00:00.000Z", status: "open", summary: "Paused write" }))).rejects.toThrow("STATE_WRITES_PAUSED");
    expect(await run(() => listTickets(identity.subject!))).toEqual([]);
  });
});