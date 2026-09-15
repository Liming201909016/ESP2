import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditStartError } from "./audit-contracts";
import { auditInput, runAudited, type AuditOptions, type AuditWriter } from "./audit-operation";

const options: AuditOptions = { identity: { authenticated: true, subject: "development:local", source: "development", displayName: "DEV", permissions: ["tickets.create"] }, kind: "skill_request", action: "route", mutation: true };
const outcome = { status: "completed" as const, httpStatus: 200, requiredPermissions: ["tickets.create" as const], references: [], trace: [] };
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("durable audit operation", () => {
  it("records the start before effects and awaits the result before returning", async () => {
    const order: string[] = [];
    const writer: AuditWriter = { begin: vi.fn(async () => { order.push("start"); }), finish: vi.fn(async () => { order.push("finish"); }) };
    const result = await runAudited(options, async (context) => { order.push("work"); return { value: { ticketId: "test-ticket", requestId: context.requestId }, outcome }; }, writer);
    expect(order).toEqual(["start", "work", "finish"]); expect(result.receipt.status).toBe("recorded");
    expect(result.value.requestId).toBe(result.receipt.requestId);
    expect(writer.finish).toHaveBeenCalledWith(expect.objectContaining({ id: result.receipt.id, traceId: result.receipt.traceId, status: "completed" }), "development:local");
  });
  it("does not invoke a mutation when the start cannot be persisted", async () => {
    const work = vi.fn();
    const writer = { begin: vi.fn().mockRejectedValue(new Error("Storage failed")), finish: vi.fn() };
    await expect(runAudited(options, work, writer)).rejects.toBeInstanceOf(AuditStartError);
    expect(work).not.toHaveBeenCalled(); expect(writer.finish).not.toHaveBeenCalled();
  });
  it("preserves a successful business receipt when audit completion fails", async () => {
    const writer = { begin: vi.fn(), finish: vi.fn().mockRejectedValue(new Error("Completion failed")) };
    const work = vi.fn(async () => ({ value: { ticketId: "created-once" }, outcome }));
    const result = await runAudited(options, work, writer);
    expect(result.value.ticketId).toBe("created-once"); expect(result.receipt.status).toBe("incomplete"); expect(work).toHaveBeenCalledTimes(1);
  });
  it("allows a read to finish but marks the audit unavailable on start failure", async () => {
    const writer = { begin: vi.fn().mockRejectedValue(new Error("Unavailable")), finish: vi.fn() };
    const result = await runAudited({ ...options, mutation: false }, async () => ({ value: "read-result", outcome }), writer);
    expect(result.value).toBe("read-result"); expect(result.receipt.status).toBe("unavailable"); expect(writer.finish).not.toHaveBeenCalled();
  });
  it("records a failure and propagates the same business error without retrying", async () => {
    const failure = new Error("Private business failure"); const writer = { begin: vi.fn(), finish: vi.fn() };
    const work = vi.fn(async () => { throw failure; });
    await expect(runAudited(options, work, writer)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1); expect(writer.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "UNHANDLED_OPERATION_FAILED" }), "development:local");
  });
  it("does not persist unidentified callers or allow them to start audited mutations", async () => {
    const writer = { begin: vi.fn(), finish: vi.fn() };
    const anonymous = { ...options, identity: { ...options.identity, authenticated: false, subject: null } };
    const result = await runAudited({ ...anonymous, mutation: false }, async () => ({ value: "denied", outcome: { ...outcome, status: "denied" as const, httpStatus: 401 } }), writer);
    expect(result.receipt).toMatchObject({ id: null, status: "not_recorded" }); expect(writer.begin).not.toHaveBeenCalled();
    await expect(runAudited(anonymous, vi.fn(), writer)).rejects.toBeInstanceOf(AuditStartError);
  });
  it("stores only input shape, approved enum values, lengths and digests", () => {
    const input = auditInput({ query: "sensitive-query", content: "sensitive-document", parameters: { description: "private-details", device: "private-device", impact: "team", token: "private-token" }, confirmed: false });
    expect(input).toMatchObject({ queryLength: 15, fields: ["description", "device", "impact"], impact: "team", confirmed: false });
    expect(input.queryHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(input)).not.toMatch(/sensitive|private/);
  });
});