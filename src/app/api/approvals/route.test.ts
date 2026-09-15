import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalError, approvalDetailSchema, approvalListSchema, type StoredApproval } from "../../../lib/esp/approval-contracts";
import { submitApproval } from "../../../lib/esp/approval-workflow";
import type { IdentityContext } from "../../../lib/esp/identity";
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin: vi.fn(), finish: vi.fn() }, getAudit: vi.fn() }));

const { getApproval, writeApproval, listApprovals, executeSkill } = vi.hoisted(() => ({ getApproval: vi.fn(), writeApproval: vi.fn(), listApprovals: vi.fn(), executeSkill: vi.fn() }));
vi.mock("../../../lib/esp/approval-store", () => ({ getApproval, writeApproval, listApprovals }));
vi.mock("../../../lib/esp/executor", () => ({ executeSkill }));
import { GET } from "./route";
import { GET as detail, POST as action } from "./[approvalId]/route";
import { GET as policies } from "../policies/route";

const identity: IdentityContext = { authenticated: true, subject: "development:local", displayName: "DEV", source: "development", permissions: ["tickets.read", "tickets.create"] };
const records = new Map<string, StoredApproval>();
let current: StoredApproval;
let revision = 0;
const context = () => ({ params: Promise.resolve({ approvalId: current.record.id }) });
function request(body: unknown, headers: Record<string, string> = {}) { return new Request("http://localhost/api/approvals", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }

beforeEach(async () => {
  vi.resetAllMocks(); records.clear(); revision = 0;
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.create,tickets.read");
  getApproval.mockImplementation(async (id) => records.get(id) ?? null);
  writeApproval.mockImplementation(async (record, etag) => { if ((records.get(record.id)?.etag ?? null) !== etag) throw new ApprovalError("CONFLICT", 409); const stored = { record: structuredClone(record), etag: `v${++revision}` }; records.set(record.id, stored); return stored; });
  listApprovals.mockImplementation(async () => ({ approvals: [...records.values()], nextCursor: "next-page" }));
  current = await submitApproval("Simulated team outage", { description: "Simulated team outage", impact: "team" }, "e69d347b-0380-4ac2-b85f-ee4d83bb74c9", identity);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("approval API", () => {
  it("returns policy rules and a bounded owner-scoped queue without executing", async () => {
    expect((await (await policies(new Request("http://localhost"))).json()).policies[0].rules).toHaveLength(3);
    const response = await GET(new Request("http://localhost/api/approvals?cursor=current"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = approvalListSchema.parse(await response.json()); expect(body.nextCursor).toBe("next-page"); expect(body.approvals).toHaveLength(1);
    expect(listApprovals).toHaveBeenCalledWith("development:local", "current"); expect(executeSkill).not.toHaveBeenCalled();
  });
  it("returns the canonical snapshot and available decisions", async () => {
    const body = approvalDetailSchema.parse(await (await detail(new Request("http://localhost"), context())).json());
    expect(body.record.parameters).toEqual(current.record.parameters); expect(body.actions).toEqual(["approve", "reject", "cancel"]);
  });
  it("requires authentication and a usable ticket permission", async () => {
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false"); expect((await GET(new Request("http://localhost"))).status).toBe(401);
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
    expect((await detail(new Request("http://localhost"), context())).status).toBe(403);
    expect((await action(request({ action: "approve", etag: current.etag }), context())).status).toBe(403);
  });
  it("hides approvals from other owners and rejects invalid IDs", async () => {
    const principal = Buffer.from(JSON.stringify({ role_typ: "roles", claims: [{ typ: "oid", val: "another-user" }, { typ: "roles", val: "tickets.read" }] })).toString("base64");
    expect((await detail(new Request("http://localhost", { headers: { "x-ms-client-principal": principal } }), context())).status).toBe(404);
    expect((await detail(new Request("http://localhost"), { params: Promise.resolve({ approvalId: "../bad" }) })).status).toBe(404);
  });
  it("rejects stale decisions and requires a rejection reason", async () => {
    expect((await action(request({ action: "approve", etag: "stale" }), context())).status).toBe(409);
    expect((await action(request({ action: "reject", etag: current.etag, reason: " " }), context())).status).toBe(400);
    expect((await action(request({ action: "approve", etag: current.etag }), context())).status).toBe(200);
    expect(executeSkill).not.toHaveBeenCalled();
  });
  it("does not accept new inputs, owners or confirmation flags on a decision", async () => {
    for (const extra of [{ parameters: { impact: "individual" } }, { createdBy: "other" }, { confirmed: true }]) {
      expect((await action(request({ action: "execute", etag: current.etag, ...extra }), context())).status).toBe(400);
    }
    expect(executeSkill).not.toHaveBeenCalled();
  });
  it("runs only the saved input through the plugin with conditional ticket persistence", async () => {
    const approved = approvalDetailSchema.parse(await (await action(request({ action: "approve", etag: current.etag }), context())).json());
    executeSkill.mockImplementation(async (_skill, _query, owner, dependencies, parameters) => ({ type: "ticket_created", ticket: { ...dependencies.ticketMetadata, createdBy: owner, status: "open", summary: parameters.description, details: parameters } }));
    const response = await action(request({ action: "execute", etag: approved.etag }), context());
    const body = approvalDetailSchema.parse(await response.json()); expect(body.record.status).toBe("completed");
    expect(executeSkill).toHaveBeenCalledWith("create-it-ticket", current.record.query, "development:local", expect.objectContaining({ writeTicket: expect.any(Function), ticketMetadata: expect.objectContaining({ approvalId: current.record.id }) }), current.record.parameters);
  });
  it("preserves uncertain execution state in a 502 response", async () => {
    const approved = approvalDetailSchema.parse(await (await action(request({ action: "approve", etag: current.etag }), context())).json());
    executeSkill.mockRejectedValue(new Error("Connection lost"));
    const response = await action(request({ action: "execute", etag: approved.etag }), context());
    expect(response.status).toBe(502); const body = approvalDetailSchema.parse(await response.json());
    expect(body.record.status).toBe("execution_unknown"); expect(body.actions).toEqual(["reconcile", "execute"]);
  });
  it("validates body format and size before making a decision", async () => {
    expect((await action(request({}, { "content-type": "text/plain" }), context())).status).toBe(415);
    expect((await action(request({ reason: "x".repeat(40_000) }), context())).status).toBe(413);
    expect((await action(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0xc3, 0x28]) }), context())).status).toBe(400);
    expect(executeSkill).not.toHaveBeenCalled();
  });
});