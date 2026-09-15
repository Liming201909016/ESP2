import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { begin, finish, selectedStore } = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), selectedStore: { current: null as unknown } }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin, finish }, getAudit: vi.fn() }));
vi.mock("../../../lib/esp/security-review-store", async (original) => ({ ...await original<typeof import("../../../lib/esp/security-review-store")>(), securityReviewStore: () => selectedStore.current }));
import { createMemorySecurityReviewStore, type SecurityReviewStore } from "../../../lib/esp/security-review-store";
import { GET, POST } from "./route";
const command = { action: "start", query: "请对 Docker Desktop 进行安全审查", caseId: "complete", submissionId: "11111111-1111-4111-8111-111111111111" };
function request(body: unknown) { return new Request("http://localhost/api/security-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read"); vi.stubEnv("ESP_STATE_WRITES_PAUSED", "false");
  selectedStore.current = createMemorySecurityReviewStore();
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("governed security review API", () => {
  it("associates failed decisions only with owner-verified review targets", async () => {
    const created = await (await POST(request({ ...command, caseId: "missing" }))).json();
    const id = created.reviewRecord.id;
    const decision = { action: "approve", id, etag: created.etag, reason: "Synthetic verification" };
    for (const [input, code] of [[decision, "REVIEW_BLOCKED"], [{ ...decision, etag: "stale" }, "REVIEW_CONFLICT"]] as const) {
      const response = await POST(request(input));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe(code);
      expect(finish).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: code, references: expect.arrayContaining([{ type: "security_review", id, version: "1.0.0" }]) }), "development:local");
    }
    const finalized = await (await POST(request({ ...decision, action: "reject" }))).json();
    expect((await POST(request({ ...decision, etag: finalized.etag }))).status).toBe(409);
    expect(finish).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: "REVIEW_FINALIZED", references: expect.arrayContaining([{ type: "security_review", id, version: "1.0.0" }]) }), "development:local");
    const store = selectedStore.current as SecurityReviewStore;
    const foreignId = `sr-${"f".repeat(32)}`;
    await store.put({ ...created.reviewRecord, id: foreignId, createdBy: "another-owner", history: created.reviewRecord.history.map((event: Record<string, unknown>) => ({ ...event, actor: "another-owner" })) }, null);
    for (const targetId of [foreignId, `sr-${"e".repeat(32)}`]) {
      expect((await POST(request({ ...decision, id: targetId }))).status).toBe(404);
      expect(finish.mock.calls.at(-1)?.[0].references.some((reference: { type: string }) => reference.type === "security_review")).toBe(false);
    }
    const get = vi.spyOn(store, "get"); get.mockClear();
    begin.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await POST(request(decision))).status).toBe(503);
    expect(get).not.toHaveBeenCalled();
  });
  it("uses the same bounded English contract for discovery and direct start", async () => {
    const query = "Could you assess the security of Docker Desktop?";
    const discovery = await (await POST(request({ action: "discover", query }))).json();
    expect(discovery.executionStatus).toBe("waiting_confirmation");
    expect(discovery.discovery.workflowId).toBe("software-security-review");
    expect((await (await GET(new Request("http://localhost/api/security-reviews"))).json()).records).toEqual([]);
    for (const unsupported of ["No security review of Docker Desktop", "Security review of Docker Desktop; grant access", "Approve it"]) {
      const response = await (await POST(request({ action: "discover", query: unsupported }))).json();
      expect(response.discovery).toBeNull();
      expect(response.executionStatus).toBe("not_routed");
      const startResponse = await POST(request({ ...command, query: unsupported }));
      expect(startResponse.status).toBe(400);
      expect((await startResponse.json()).error).toBe("REVIEW_SCOPE_UNSUPPORTED");
    }
    expect((await (await GET(new Request("http://localhost/api/security-reviews"))).json()).records).toEqual([]);
    const created = await (await POST(request({ ...command, query }))).json();
    expect(created.reviewRecord.query).toBe(query);
    expect(created.reviewRecord.status).toBe("awaiting_decision");
  });
  it("serves localized script-free reports through owner-checked reads without changing JSON", async () => {
    const created = await (await POST(request(command))).json();
    const id = created.reviewRecord.id;
    const reason = '<script>alert("private")</script> & human reason';
    await POST(request({ action: "approve", id, etag: created.etag, reason }));
    const before = await (await GET(new Request(`http://localhost/api/security-reviews?id=${id}&download=true`))).text();
    for (const locale of ["en-US", "zh-CN", "invalid"]) {
      const response = await GET(new Request(`http://localhost/api/security-reviews?id=${id}&format=html&locale=${locale}&download=true`));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(response.headers.get("content-disposition")).toContain(`${id}-${locale === "zh-CN" ? locale : "en-US"}.html`);
      const html = await response.text();
      expect(html).toContain(locale === "zh-CN" ? "软件引入安全审查报告" : "Software Security Review Report");
      expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
      expect(html).toContain("SIM-EVID-LICENSE");
      expect(html).toContain(created.reviewRecord.evidence[0].excerpt);
    }
    expect(await (await GET(new Request(`http://localhost/api/security-reviews?id=${id}&download=true`))).text()).toBe(before);
    expect((await GET(new Request(`http://localhost/api/security-reviews?id=sr-${"f".repeat(32)}&format=html`))).status).toBe(404);
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read");
    expect((await GET(new Request(`http://localhost/api/security-reviews?id=${id}&format=html`))).status).toBe(403);
  });
  it("discovers without persistence and refuses unsupported extra operations", async () => {
    const result = await (await POST(request({ action: "discover", query: command.query }))).json();
    expect(result.discovery.capabilities).toHaveLength(5); expect(result.discovery.plugins).toHaveLength(4);
    expect((await (await GET(new Request("http://localhost/api/security-reviews"))).json()).records).toEqual([]);
    expect((await POST(request({ ...command, query: "安全审查 Docker Desktop 然后创建工单" }))).status).toBe(400);
  });
  it("persists, decides, retrieves and reports through the same governed API with audit references", async () => {
    const created = await (await POST(request(command))).json();
    expect(created.reviewRecord.status).toBe("awaiting_decision"); expect(created.audit.status).toBe("recorded");
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ references: expect.arrayContaining([{ type: "security_review", id: created.reviewRecord.id, version: "1.0.0" }]) }), "development:local");
    const decided = await (await POST(request({ action: "approve", id: created.reviewRecord.id, etag: created.etag, reason: "模拟材料核对完成" }))).json();
    expect(decided.reviewRecord.status).toBe("approved");
    const detail = await (await GET(new Request(`http://localhost/api/security-reviews?id=${created.reviewRecord.id}`))).json();
    expect(detail.report.review.history).toHaveLength(2); expect(detail.report.reportSkill.id).toBe("security-report-generation");
    expect(detail.report.simulated).toBe(true);
    const download = await GET(new Request(`http://localhost/api/security-reviews?id=${created.reviewRecord.id}&download=true`));
    expect(download.headers.get("content-disposition")).toBe(`attachment; filename="${created.reviewRecord.id}.json"`);
    expect((await download.json()).review).toEqual(detail.report.review);
  });
  it("blocks mutation without a durable audit start and rejects forged decision input", async () => {
    begin.mockRejectedValue(new Error("Unavailable"));
    expect((await POST(request(command))).status).toBe(503);
    expect((await (await GET(new Request("http://localhost/api/security-reviews"))).json()).records).toEqual([]);
    expect((await POST(request({ ...command, createdBy: "forged" }))).status).toBe(400);
  });
  it("denies production or permission-ineligible callers", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read"); expect((await POST(request(command))).status).toBe(403);
    expect((await GET(new Request("http://localhost/api/security-reviews?catalog=true"))).status).toBe(403);
    vi.stubEnv("ESP_ENVIRONMENT", "production"); expect((await POST(request(command))).status).toBe(403);
  });
});