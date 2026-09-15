import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { execute, begin, finish } = vi.hoisted(() => ({ execute: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
vi.mock("../../../lib/esp/executor", () => ({ executeSkill: execute }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin, finish }, getAudit: vi.fn() }));
import { GET, POST } from "./route";
import { workflowResponseSchema } from "../../../lib/esp/workflow-contracts";

const input = { workflowId: "ticket-handling-guidance", query: "查询工单 ESP-20260911-03CE94E1 后查询规范" };
const ticket = { type: "ticket_status", ticket: { id: "ESP-20260911-03CE94E1", status: "open", summary: "VPN 无法连接", createdAt: "2026-09-11T00:00:00Z", createdBy: "development:local" } };
function request(body: unknown = input) { return new Request("http://localhost/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read,tickets.read"); vi.resetAllMocks(); });
afterEach(() => vi.unstubAllEnvs());

describe("fixed workflow API", () => {
  it("lists only whole workflows available to the current identity without executing", async () => {
    const result = await GET(new Request("http://localhost/api/workflows"));
    expect((await result.json()).workflows).toHaveLength(1); expect(result.headers.get("cache-control")).toBe("private, no-store");
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read");
    expect(await (await GET(new Request("http://localhost/api/workflows"))).json()).toEqual({ workflows: [] });
    expect(execute).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });

  it("records root and both read steps and retains upstream data on no evidence", async () => {
    execute.mockResolvedValueOnce(ticket).mockResolvedValueOnce({ type: "knowledge_not_found", corpus: "dev-samples" });
    const response = await POST(request()); const body = workflowResponseSchema.parse(await response.json());
    expect(response.status).toBe(200); expect(body.workflow.executionStatus).toBe("partial");
    expect(begin).toHaveBeenCalledTimes(3); expect(finish).toHaveBeenCalledTimes(3);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ requestId: body.workflow.requestId, status: "partial", references: expect.arrayContaining([{ type: "ticket", id: ticket.ticket.id }]) }), "development:local");
    expect(execute.mock.calls.map((call) => call[0])).toEqual(["get-ticket-status", "search-software-catalog"]);
    expect(JSON.stringify(begin.mock.calls)).not.toContain(ticket.ticket.summary);
  });

  it("records failure plus skipped work without starting a second child", async () => {
    execute.mockRejectedValue(new Error("private backend error"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(502); expect(workflowResponseSchema.parse(body).workflow.steps[1].status).toBe("skipped");
    expect(begin).toHaveBeenCalledTimes(2); expect(execute).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", trace: expect.arrayContaining([{ step: "workflow.guidance.skipped.upstream_not_completed", at: expect.any(String) }]) }), "development:local");
    expect(JSON.stringify(body)).not.toContain("private backend");
  });

  it.each([{ ...input, confirmed: true }, { ...input, steps: [] }, { ...input, workflowId: "recursive-workflow" }, { ...input, identity: { subject: "other" } }])("rejects arbitrary execution controls before audit or execution", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(execute).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });

  it("rejects unauthorized requests before any reads", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read"); expect((await POST(request())).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false"); expect((await POST(request())).status).toBe(401);
    expect(execute).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });

  it("rejects non-JSON and oversized inputs", async () => {
    expect((await POST(new Request("http://localhost/api/workflows", { method: "POST", body: "text" }))).status).toBe(415);
    expect((await POST(request({ ...input, query: "x".repeat(40_000) }))).status).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });
});