import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeConfirmedTicket, prepareTicketConfirmation } from "./ticket-confirmation";
import type { IdentityContext } from "./identity";
import type { TicketRecord } from "./ticket-store";

const identity: IdentityContext = { authenticated: true, subject: "development:local", source: "development", displayName: "DEV", permissions: ["tickets.create"] };
const context = { id: "aud-8210000000000-11111111111141118111111111111111", requestId: "11111111-1111-4111-8111-111111111111", traceId: "22222222-2222-4222-8222-222222222222" };
const details = { description: "VPN connection fails", impact: "individual" as const, device: "SIM-LT-0042" };
const query = "Create ticket for VPN";
const submission = "33333333-3333-4333-8333-333333333333";
function setup() {
  const records = new Map(); const tickets = new Map<string, TicketRecord>();
  const dependencies = {
    store: { read: vi.fn(async (owner: string, id: string) => records.get(`${owner}/${id}`) ?? null), create: vi.fn(async (record) => { if (!records.has(`${record.owner}/${record.id}`)) records.set(`${record.owner}/${record.id}`, record); }) },
    now: () => new Date("2026-09-14T00:00:00Z"), writer: { begin: vi.fn(), finish: vi.fn() },
    readTicket: vi.fn(async (id: string, owner: string) => tickets.get(id)?.createdBy === owner ? tickets.get(id)! : null),
    writeTicket: vi.fn(async (ticket: TicketRecord) => { tickets.set(ticket.id, ticket); }),
  };
  return { dependencies, records, tickets };
}
beforeEach(() => { vi.stubEnv("ESP_STATE_BACKEND", "blob"); vi.stubEnv("ESP_STATE_WRITES_PAUSED", "false"); });
afterEach(() => vi.unstubAllEnvs());

describe("individual ticket confirmation", () => {
  it("uses one reserved receipt across concurrent confirmations", async () => {
    const { dependencies, tickets } = setup();
    await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    const results = await Promise.all(Array.from({ length: 5 }, () => executeConfirmedTicket(submission, query, details, identity, dependencies)));
    expect(new Set(results.map((result) => result.execution.ticket.id)).size).toBe(1);
    expect(tickets.size).toBe(1);
    expect(dependencies.writeTicket.mock.calls.every(([ticket]) => JSON.stringify(ticket) === JSON.stringify(results[0].execution.ticket))).toBe(true);
  });
  it("rejects lost permission, paused writes and receipt collisions", async () => {
    const { dependencies, tickets } = setup();
    const preview = await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    await expect(executeConfirmedTicket(submission, query, details, { ...identity, permissions: [] }, dependencies)).rejects.toThrow("CONFIRMATION_NOT_FOUND");
    vi.stubEnv("ESP_STATE_WRITES_PAUSED", "true");
    await expect(executeConfirmedTicket(submission, query, details, identity, dependencies)).rejects.toThrow("STATE_WRITES_PAUSED");
    vi.stubEnv("ESP_STATE_WRITES_PAUSED", "false");
    tickets.set(preview.ticketId, { id: preview.ticketId, summary: "Other receipt", status: "open", createdAt: "2026-09-14T00:00:00Z", createdBy: identity.subject! });
    await expect(executeConfirmedTicket(submission, query, details, identity, dependencies)).rejects.toThrow("CONFIRMATION_CONFLICT");
    expect(dependencies.writeTicket).not.toHaveBeenCalled();
  });
  it("freezes the preview, reuses identical submissions and returns the original receipt on replay", async () => {
    const { dependencies, tickets } = setup();
    const preview = await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    expect(tickets.size).toBe(0);
    expect(await prepareTicketConfirmation(query, details, identity, context, submission, dependencies)).toEqual(preview);
    const first = await executeConfirmedTicket(preview.id, query, details, identity, dependencies);
    const repeated = await executeConfirmedTicket(preview.id, query, details, identity, dependencies);
    expect(first.receiptReused).toBe(false); expect(repeated.receiptReused).toBe(true);
    expect(repeated.execution).toEqual(first.execution); expect(tickets.size).toBe(1); expect(dependencies.writeTicket).toHaveBeenCalledTimes(1);
  });
  it.each(["description", "device", "impact", "query", "owner", "backend", "version"])("rejects changed %s before writing", async (field) => {
    const { dependencies, records } = setup();
    await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    const changed = { ...details, ...(field === "description" ? { description: "Changed fault" } : field === "device" ? { device: "Other" } : field === "impact" ? { impact: "team" as const } : {}) };
    if (field === "backend") vi.stubEnv("ESP_STATE_BACKEND", "postgres");
    if (field === "version") records.get(`${identity.subject}/${submission}`).skillVersion = "obsolete";
    await expect(executeConfirmedTicket(submission, field === "query" ? "Changed query" : query, changed, field === "owner" ? { ...identity, subject: "other" } : identity, dependencies)).rejects.toThrow(/CONFIRMATION_(CONFLICT|NOT_FOUND)/);
    expect(dependencies.writeTicket).not.toHaveBeenCalled();
  });
  it("requires an issued token, rejects expiry, but permits read-only receipt recovery after expiry", async () => {
    const { dependencies } = setup();
    await expect(executeConfirmedTicket(undefined, query, details, identity, dependencies)).rejects.toThrow("CONFIRMATION_REQUIRED");
    await expect(executeConfirmedTicket(submission, query, details, identity, dependencies)).rejects.toThrow("CONFIRMATION_NOT_FOUND");
    await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    const later = { ...dependencies, now: () => new Date("2026-09-14T00:15:00Z") };
    await expect(executeConfirmedTicket(submission, query, details, identity, later)).rejects.toThrow("CONFIRMATION_EXPIRED");
    const first = await executeConfirmedTicket(submission, query, details, identity, dependencies);
    expect((await executeConfirmedTicket(submission, query, details, identity, later)).execution).toEqual(first.execution);
  });
  it("recovers a lost write acknowledgement from the reserved ticket rather than creating another", async () => {
    const { dependencies, tickets } = setup();
    await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    dependencies.writeTicket.mockImplementationOnce(async (ticket) => { tickets.set(ticket.id, ticket); throw new Error("ack lost"); });
    await expect(executeConfirmedTicket(submission, query, details, identity, dependencies)).rejects.toThrow("ack lost");
    expect((await executeConfirmedTicket(submission, query, details, identity, dependencies)).receiptReused).toBe(true);
    expect(tickets.size).toBe(1); expect(dependencies.writeTicket).toHaveBeenCalledTimes(1);
  });
  it("rejects same submission with different preview input and requires audit before preview persistence", async () => {
    const { dependencies } = setup();
    await prepareTicketConfirmation(query, details, identity, context, submission, dependencies);
    await expect(prepareTicketConfirmation(query, { ...details, device: "Changed" }, identity, context, submission, dependencies)).rejects.toThrow("CONFIRMATION_CONFLICT");
    dependencies.writer.begin.mockRejectedValue(new Error("unavailable")); dependencies.store.create.mockClear();
    await expect(prepareTicketConfirmation(query, details, identity, context, submission, dependencies)).rejects.toThrow();
    expect(dependencies.store.create).not.toHaveBeenCalled();
  });
});