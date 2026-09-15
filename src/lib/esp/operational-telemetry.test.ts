import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditStartError } from "./audit-contracts";
import { runAudited, type AuditOptions } from "./audit-operation";
import { emitOperationEvent, operationEventSchema } from "./operational-telemetry";

const options: AuditOptions = {
  identity: { authenticated: true, subject: "private-user", displayName: "Private test user", source: "development", permissions: ["tickets.create"] },
  action: "tickets.create", kind: "skill_request", mutation: true,
  input: { fields: ["description"], queryLength: 100, queryHash: "a".repeat(64) }, references: [{ type: "ticket", id: "private-ticket" }],
};
const outcome = { status: "completed" as const, httpStatus: 200, requiredPermissions: [], references: [], trace: [] };

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function event() {
  const calls = vi.mocked(console.info).mock.calls;
  expect(calls).toHaveLength(1);
  return operationEventSchema.parse(JSON.parse(String(calls[0][0])));
}

describe("minimal operational events", () => {
  it("emits one classified completion without user, business identifiers or content", async () => {
    const result = await runAudited(options, async () => ({ value: "private result", outcome }), { begin: vi.fn(), finish: vi.fn() });
    const logged = event();
    expect(logged).toMatchObject({ event: "esp.operation", requestId: result.receipt.requestId, traceId: result.receipt.traceId, outcome: "completed", httpStatus: 200, auditStatus: "recorded", mutation: true, invoked: true });
    expect(JSON.stringify(logged)).not.toMatch(/private|query|references|permissions|subject/);
    expect(logged.durationMs).toBeGreaterThanOrEqual(0);
  });
  it("distinguishes a blocked mutation from an invoked business failure", async () => {
    const work = vi.fn();
    await expect(runAudited(options, work, { begin: vi.fn().mockRejectedValue(new Error("secret")), finish: vi.fn() })).rejects.toBeInstanceOf(AuditStartError);
    expect(work).not.toHaveBeenCalled();
    expect(event()).toMatchObject({ invoked: false, httpStatus: 503, errorCode: "AUDIT_START_FAILED", auditStatus: "unavailable" });
  });
  it("reports audit finalization degradation without changing business success", async () => {
    const result = await runAudited(options, async () => ({ value: "created", outcome }), { begin: vi.fn(), finish: vi.fn().mockRejectedValue(new Error("secret")) });
    expect(result.value).toBe("created");
    expect(event()).toMatchObject({ outcome: "completed", httpStatus: 200, auditStatus: "incomplete", invoked: true });
  });
  it("retains failures and does not log exception messages", async () => {
    const failure = new Error("secret server endpoint");
    await expect(runAudited(options, async () => { throw failure; }, { begin: vi.fn(), finish: vi.fn() })).rejects.toBe(failure);
    expect(event()).toMatchObject({ outcome: "failed", httpStatus: 500, errorCode: "UNHANDLED_OPERATION_FAILED", invoked: true });
  });
  it("records no-evidence separately from failed requests when audit is unavailable", async () => {
    await runAudited({ ...options, mutation: false }, async () => ({ value: null, outcome: { ...outcome, status: "no_evidence" as const } }), { begin: vi.fn().mockRejectedValue(new Error("secret")), finish: vi.fn() });
    expect(event()).toMatchObject({ outcome: "no_evidence", httpStatus: 200, auditStatus: "unavailable" });
  });
  it("never fails or retries the business operation when the logging sink throws", async () => {
    vi.mocked(console.info).mockImplementation(() => { throw new Error("Sink unavailable"); });
    const work = vi.fn(async () => ({ value: "created once", outcome }));
    const result = await runAudited(options, work, { begin: vi.fn(), finish: vi.fn() });
    expect(result.value).toBe("created once"); expect(work).toHaveBeenCalledTimes(1);
  });
  it("discards a malformed event instead of writing arbitrary data to the sink", () => {
    expect(() => emitOperationEvent({ event: "secret" } as never)).not.toThrow();
    expect(console.info).not.toHaveBeenCalled();
  });
});