import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditOptions } from "./audit-operation";

const { begin, finish, getAudit } = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), getAudit: vi.fn() }));
vi.mock("./audit-store", () => ({ auditWriter: { begin, finish }, getAudit }));
import { auditOutcome, auditedResponse } from "./audit-http";

const options: AuditOptions = { identity: { authenticated: true, subject: "owner", source: "development", displayName: null, permissions: ["knowledge.read", "tickets.create"] }, kind: "skill_request", action: "route", mutation: false };
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe("audit HTTP boundary", () => {
  it("records only allowlisted missing-evidence reasons in nested workflow audits", () => {
    const outcome = auditOutcome({ executionStatus: "partial", workflow: { workflowId: "ticket-handling-guidance", steps: [{ execution: null }, { execution: { type: "knowledge_not_found", reason: "model_unsupported", answer: "private draft" } }] } }, 200, options);
    expect(outcome.trace).toContainEqual({ step: "knowledge.no_evidence.model_unsupported", at: expect.any(String) });
    expect(outcome.status).toBe("partial"); expect(JSON.stringify(outcome)).not.toContain("private draft");
    const unknown = auditOutcome({ executionStatus: "no_evidence", execution: { type: "knowledge_not_found", reason: "private provider data" } }, 200, options);
    expect(unknown.status).toBe("no_evidence"); expect(JSON.stringify(unknown)).not.toContain("private provider");
  });

  it("returns the original status/result together with the durable audit receipt", async () => {
    const response = await auditedResponse(new Request("http://localhost"), options, async (context) => Response.json({ requestId: context.requestId, executionStatus: "needs_input", intent: { privateQuery: "not-an-audit-field" } }, { status: 200 }));
    const body = await response.json(); expect(body.audit.status).toBe("recorded"); expect(body.requestId).toBe(body.audit.requestId);
    expect(response.headers.get("x-esp-audit-id")).toBe(body.audit.id); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(finish.mock.calls)).not.toContain("not-an-audit-field");
  });
  it("records versions/references without copying answer, excerpts or input values", () => {
    const outcome = auditOutcome({ executionStatus: "completed", route: { skill: { id: "search-company-policy", version: "0.2.0", permissions: ["knowledge.read"] } }, execution: { type: "knowledge_answer", answer: "private-answer", citations: [{ id: "dev-hr-leave", version: "v1", excerpt: "private-excerpt" }] } }, 200, options);
    expect(outcome.references).toContainEqual({ type: "source", id: "dev-hr-leave", version: "v1" });
    expect(outcome.references).toContainEqual({ type: "plugin", id: "knowledge", version: "0.1.0" });
    expect(JSON.stringify(outcome)).not.toContain("private"); expect(outcome.requiredPermissions).toEqual(["knowledge.read"]);
  });
  it("keeps incomplete audit distinct from successful mutation", async () => {
    finish.mockRejectedValue(new Error("Audit outage"));
    const response = await auditedResponse(new Request("http://localhost"), { ...options, mutation: true }, async () => Response.json({ record: { id: `apr-${"a".repeat(32)}`, status: "approved" } }));
    expect(response.status).toBe(200); expect((await response.json()).audit.status).toBe("incomplete");
  });
  it("fails before mutation if the durable start cannot be written", async () => {
    begin.mockRejectedValue(new Error("Audit unavailable")); const handler = vi.fn();
    const response = await auditedResponse(new Request("http://localhost"), { ...options, mutation: true }, handler);
    expect(response.status).toBe(503); expect((await response.json()).error).toBe("AUDIT_START_FAILED"); expect(handler).not.toHaveBeenCalled();
  });
  it("joins only an accessible server-owned parent trace", async () => {
    const id = `aud-8210900000000-${"a".repeat(32)}`; const traceId = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
    getAudit.mockResolvedValue({ start: { id, traceId } });
    const request = new Request("http://localhost", { headers: { "x-esp-parent-audit-id": id } });
    const handler = vi.fn(async () => Response.json({ executionStatus: "completed" }));
    const body = await (await auditedResponse(request, options, handler)).json();
    expect(body.audit.traceId).toBe(traceId); expect(begin).toHaveBeenCalledWith(expect.objectContaining({ parentId: id, traceId }));
    getAudit.mockResolvedValue(null); handler.mockClear();
    expect((await auditedResponse(request, options, handler)).status).toBe(404); expect(handler).not.toHaveBeenCalled();
  });
  it("retains a failed business HTTP status instead of reporting it as audit failure", async () => {
    const response = await auditedResponse(new Request("http://localhost"), options, async () => Response.json({ error: "EXECUTION_FAILED", executionStatus: "failed" }, { status: 502 }));
    const body = await response.json(); expect(response.status).toBe(502); expect(body.audit.status).toBe("recorded");
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "EXECUTION_FAILED", httpStatus: 502 }), "owner");
  });
});