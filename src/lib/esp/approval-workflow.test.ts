import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalError, type ApprovalRecord, type StoredApproval } from "./approval-contracts";
import { approvalDetails, changeApproval, effectiveApproval, plannedApprovalTicket, submitApproval, type ApprovalDependencies } from "./approval-workflow";
import type { IdentityContext } from "./identity";
import { invokePlugin } from "./plugin-execution";

const identity: IdentityContext = { authenticated: true, subject: "development:local", displayName: "DEV", source: "development", permissions: ["tickets.create", "tickets.read"] };
const input = { description: "Simulated team VPN outage", impact: "team" as const, device: "SIM-VPN" };
const submissionId = "873ad1bf-1556-4baa-a906-925c0d0187ba";
beforeEach(() => { vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); });
afterEach(() => vi.unstubAllEnvs());

function setup() {
  const records = new Map<string, StoredApproval>();
  let revision = 0;
  const dependencies: ApprovalDependencies = {
    get: vi.fn(async (id) => records.get(id) ?? null),
    write: vi.fn(async (record, etag) => {
      const existing = records.get(record.id);
      if ((existing?.etag ?? null) !== etag) throw new ApprovalError("CONFLICT", 409);
      const stored = { record: structuredClone(record), etag: `v${++revision}` }; records.set(record.id, stored); return stored;
    }),
    readTicket: vi.fn(async () => null), execute: vi.fn(async (record) => plannedApprovalTicket(record)), now: vi.fn(() => "2026-09-11T01:00:00.000Z"),
  };
  const submit = () => submitApproval("Simulated outage", input, submissionId, identity, dependencies);
  const act = (stored: StoredApproval, action: "approve" | "reject" | "cancel" | "execute" | "reconcile", reason?: string) => changeApproval(stored.record.id, { action, reason, etag: stored.etag }, identity, dependencies);
  return { dependencies, records, submit, act };
}

describe("approval lifecycle", () => {
  it("stores canonical inputs and a 24-hour policy snapshot without executing", async () => {
    const { submit, dependencies } = setup(); const stored = await submit();
    expect(stored.record).toMatchObject({ status: "pending", createdBy: identity.subject, parameters: input, expiresAt: "2026-09-12T01:00:00.000Z", policy: { version: "1.0.0", effect: "approval" } });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });
  it("deduplicates repeat and concurrent submissions by owner and client key", async () => {
    const { submit, records } = setup(); const [first, second] = await Promise.all([submit(), submit()]);
    expect(second).toEqual(first); expect(records.size).toBe(1); expect(await submit()).toEqual(first);
  });
  it("rejects reuse of a submission key for changed input", async () => {
    const { submit, dependencies } = setup(); await submit();
    await expect(submitApproval("Different request", input, submissionId, identity, dependencies)).rejects.toThrow("SUBMISSION_CONFLICT");
  });
  it("cannot execute a pending request or execute while merely approving", async () => {
    const { submit, act, dependencies } = setup(); const pending = await submit();
    await expect(act(pending, "execute")).rejects.toThrow("INVALID_TRANSITION");
    const approved = await act(pending, "approve", "Reviewed simulated scope");
    expect(approved.record.status).toBe("approved"); expect(dependencies.execute).not.toHaveBeenCalled();
  });
  it("executes the stored snapshot once and returns the same receipt on repeat execution", async () => {
    const { submit, act, dependencies } = setup(); const approved = await act(await submit(), "approve");
    const completed = await act(approved, "execute");
    expect(completed.record.status).toBe("completed"); expect(completed.record.ticket?.details).toEqual(input);
    expect(completed.record.ticket?.approvalId).toBe(completed.record.id);
    expect(await act(approved, "execute")).toEqual(completed); expect(dependencies.execute).toHaveBeenCalledTimes(1);
  });
  it("accepts the real plugin receipt when an optional device was omitted", async () => {
    const { act, dependencies } = setup();
    const stored = await submitApproval("No device specified", { description: "Simulated team outage", impact: "team" }, submissionId, identity, dependencies);
    dependencies.execute = async (record) => {
      const ticket = plannedApprovalTicket(record);
      const result = await invokePlugin("tickets.create", { skillId: record.skillId, query: record.query, createdBy: record.createdBy, parameters: record.parameters }, {
        writeTicket: vi.fn(), ticketMetadata: { id: ticket.id, createdAt: ticket.createdAt, approvalId: record.id },
      });
      if (result.type !== "ticket_created") throw new Error("Missing ticket");
      return result.ticket;
    };
    expect((await act(await act(stored, "approve"), "execute")).record.status).toBe("completed");
  });
  it("does not execute both concurrent confirmation requests", async () => {
    const { submit, act, dependencies } = setup(); const approved = await act(await submit(), "approve");
    const results = await Promise.allSettled([act(approved, "execute"), act(approved, "execute")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(dependencies.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["reject", "cancel"] as const)("does not execute after %s", async (action) => {
    const { submit, act, dependencies } = setup(); const stopped = await act(await submit(), action, "Simulation decision");
    await expect(act(stopped, "execute")).rejects.toThrow("INVALID_TRANSITION");
    await expect(act(stopped, "approve")).rejects.toThrow("INVALID_TRANSITION");
    expect(dependencies.execute).not.toHaveBeenCalled();
  });
  it("requires a rejection reason and preserves a previous ETag conflict", async () => {
    const { submit, act } = setup(); const pending = await submit();
    await expect(act(pending, "reject", " ")).rejects.toThrow();
    await act(pending, "approve"); await expect(act(pending, "reject", "Stale decision")).rejects.toThrow("CONFLICT");
  });
  it("permits withdrawal of an approved request before execution", async () => {
    const { submit, act } = setup(); expect((await act(await act(await submit(), "approve"), "cancel")).record.status).toBe("cancelled");
  });
  it.each(["pending", "approved"] as const)("expires %s requests and blocks execution at the boundary", async (status) => {
    const { submit, act, dependencies } = setup(); const pending = await submit(); const stored = status === "approved" ? await act(pending, "approve") : pending;
    dependencies.now = () => stored.record.expiresAt;
    expect(effectiveApproval(stored.record, dependencies.now()).status).toBe("expired");
    expect(approvalDetails(stored, identity, dependencies.now()).actions).toEqual([]);
    await expect(act(stored, status === "pending" ? "approve" : "execute")).rejects.toThrow("APPROVAL_EXPIRED");
    expect(dependencies.execute).not.toHaveBeenCalled();
  });
  it("does not let another owner read or decide this request", async () => {
    const { submit, dependencies } = setup(); const stored = await submit();
    await expect(changeApproval(stored.record.id, { action: "approve", etag: stored.etag }, { ...identity, subject: "other" }, dependencies)).rejects.toThrow("NOT_FOUND");
  });
  it("requires the explicit DEV reviewer mode and existing write permission", async () => {
    const { submit, dependencies } = setup(); const stored = await submit(); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false");
    await expect(changeApproval(stored.record.id, { action: "approve", etag: stored.etag }, identity, dependencies)).rejects.toThrow("DEV_REVIEW_REQUIRED");
    await expect(submit()).rejects.toThrow("DEV_REVIEW_REQUIRED");
    await expect(changeApproval(stored.record.id, { action: "cancel", etag: stored.etag }, { ...identity, permissions: ["tickets.read"] }, dependencies)).rejects.toThrow("PERMISSION_REQUIRED");
  });
  it("rejects tampering with the approved input snapshot", async () => {
    const { submit, act, records, dependencies } = setup(); const approved = await act(await submit(), "approve");
    records.set(approved.record.id, { ...approved, record: { ...approved.record, parameters: { ...input, description: "Changed after review" } } });
    await expect(act(approved, "execute")).rejects.toThrow("APPROVAL_INPUT_CHANGED"); expect(dependencies.execute).not.toHaveBeenCalled();
  });
  it("retains uncertain outcomes and reconciles a committed receipt without executing again", async () => {
    const { submit, act, dependencies } = setup(); const approved = await act(await submit(), "approve");
    dependencies.execute = vi.fn(async () => { throw new Error("Lost response"); });
    const uncertain = await act(approved, "execute"); expect(uncertain.record.status).toBe("execution_unknown");
    dependencies.readTicket = vi.fn(async () => plannedApprovalTicket(uncertain.record));
    const reconciled = await act(uncertain, "reconcile"); expect(reconciled.record.status).toBe("completed"); expect(dependencies.execute).toHaveBeenCalledTimes(1);
  });
  it("reuses the same reserved ID and original timestamp on an explicit retry", async () => {
    const { submit, act, dependencies } = setup(); const approved = await act(await submit(), "approve");
    dependencies.execute = vi.fn().mockRejectedValueOnce(new Error("Lost response")).mockImplementation(async (record: ApprovalRecord) => plannedApprovalTicket(record));
    const uncertain = await act(approved, "execute"); dependencies.now = () => "2026-09-11T02:00:00.000Z";
    const completed = await act(uncertain, "execute"); expect(completed.record.ticket?.id).toBe(uncertain.record.execution?.ticketId);
    expect(completed.record.ticket?.createdAt).toBe(uncertain.record.execution?.createdAt); expect(completed.record.execution?.attempts).toBe(2);
  });
  it("limits automatic effects and manual retries to three attempts", async () => {
    const { submit, act, dependencies } = setup(); dependencies.execute = vi.fn(async () => { throw new Error("Dependency failed"); });
    let stored = await act(await submit(), "approve");
    for (let attempt = 0; attempt < 3; attempt += 1) stored = await act(stored, "execute");
    expect(dependencies.execute).toHaveBeenCalledTimes(3); await expect(act(stored, "execute")).rejects.toThrow("INVALID_TRANSITION");
    expect(approvalDetails(stored, identity, dependencies.now()).actions).toEqual(["reconcile"]);
  });
  it("recovers a lost final status write through receipt reconciliation after the execution lease", async () => {
    const { submit, act, dependencies, records } = setup(); const approved = await act(await submit(), "approve"); const write = dependencies.write;
    dependencies.write = async (record, etag) => { if (record.status === "completed") throw new Error("Final state write failed"); return write(record, etag); };
    await expect(act(approved, "execute")).rejects.toThrow("Final state write failed");
    const running = records.get(approved.record.id)!;
    await expect(act(running, "reconcile")).rejects.toThrow("EXECUTION_BUSY");
    dependencies.now = () => "2026-09-11T01:02:00.000Z"; dependencies.write = write;
    dependencies.readTicket = async () => plannedApprovalTicket(running.record);
    expect((await act(running, "reconcile")).record.status).toBe("completed"); expect(dependencies.execute).toHaveBeenCalledTimes(1);
  });
});