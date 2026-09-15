import { expect, it, vi } from "vitest";
import { evaluateDemo } from "./evaluate-demo.mjs";

const requestId = "11111111-1111-4111-8111-111111111111";
const auditId = "aud-8210000000000-11111111111141118111111111111111";
function fixture() {
  return vi.fn(async (url: URL, options?: RequestInit) => {
    let body: unknown;
    if (url.pathname === "/api/skills") body = { skills: [
      { id: "search-company-policy", name: "HR", knowledgeBase: { id: "enterprise", indexName: "esp-knowledge-dev-v1" }, sources: [{ id: "dev-hr-leave" }] },
      { id: "search-expense-policy", name: "Finance", knowledgeBase: { id: "finance", indexName: "esp-finance-dev-v1" }, sources: [{ id: "dev-travel-approval" }] },
    ] };
    else if (url.pathname === "/api/plugins") body = { plugins: [{ id: "knowledge", dependencies: [{ id: "foundry", configured: true }] }] };
    else if (url.pathname === "/api/readiness") body = { status: "ready", validUntil: new Date(Date.now() + 60_000).toISOString(), checks: { blob: { status: "healthy" }, search: { status: "healthy" }, state: { status: "healthy" } } };
    else if (url.pathname === "/api/release") body = { releaseId: requestId, buildId: "build", sourceCommit: "local" };
    else if (url.pathname === "/api/state") body = { backend: "postgres", writesPaused: false, postgres: { prepared: true, counts: { tickets: 2, approvals: 1 } } };
    else if (url.pathname === "/api/tickets") body = { tickets: [] };
    else if (url.pathname === "/api/route") {
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toEqual(expect.objectContaining({ confirmed: false }));
      expect(JSON.parse(String(options?.body))).not.toHaveProperty("selectedSkillId");
      body = { requestId, route: { status: "no_match" }, executionStatus: "needs_input", execution: { type: "intent_clarification" }, skillUsage: [], audit: { id: auditId, status: "recorded", requestId, traceId: requestId } };
    } else if (url.pathname === `/api/audit/${auditId}`) body = { start: { requestId, traceId: requestId, mutation: false }, result: { status: "needs_input" } };
    else throw new Error("Unexpected request");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

it("defaults to preflight-only and never calls route or changes state", async () => {
  const request = fixture();
  const report = await evaluateDemo("http://localhost:3100", { caseId: "DEMO-001" }, request);
  expect(report.passed).toBe(true); expect(report.mode).toBe("preflight_only");
  expect(request.mock.calls.every(([url]) => url.pathname !== "/api/route")).toBe(true);
});

it("runs one unselected read request and verifies audit/counts without storing business text", async () => {
  const request = fixture();
  const report = await evaluateDemo("http://localhost:3100", { caseId: "DEMO-003", run: true }, request);
  expect(report.passed).toBe(true); expect(report.businessCountsUnchanged).toBe(true);
  expect(report.cases[0]).toMatchObject({ status: "passed", auditsVerified: 1 });
  expect(request.mock.calls.filter(([url]) => url.pathname === "/api/route")).toHaveLength(1);
  expect(JSON.stringify(report)).not.toMatch(/年假|query|answer|excerpt/);
});

it("does not invent a ticket or run a blocked case", async () => {
  const request = fixture();
  const report = await evaluateDemo("http://localhost:3100", { caseId: "DEMO-002", run: true }, request);
  expect(report.passed).toBe(false); expect(report.cases[0].status).toBe("blocked");
  expect(request.mock.calls.filter(([url]) => url.pathname === "/api/route")).toHaveLength(0);
});

it("retains failed responses without retrying or leaking raw errors", async () => {
  const base = fixture();
  const request = vi.fn(async (url: URL, options?: RequestInit) => url.pathname === "/api/route" ? new Response(JSON.stringify({ requestId, error: "private provider data" }), { status: 502 }) : base(url, options));
  const report = await evaluateDemo("http://localhost:3100", { caseId: "DEMO-001", run: true }, request);
  expect(report.passed).toBe(false); expect(report.cases[0]).toMatchObject({ status: "failed", error: "DEMO_HTTP_FAILED", httpStatus: 502 });
  expect(request.mock.calls.filter(([url]) => url.pathname === "/api/route")).toHaveLength(1);
  expect(JSON.stringify(report)).not.toContain("private provider");
});

it("records partial results as failures rather than HTTP successes", async () => {
  const base = fixture();
  const request = vi.fn(async (url: URL, options?: RequestInit) => url.pathname === "/api/route" ? new Response(JSON.stringify({ requestId, executionStatus: "partial", route: { status: "parallel" }, skillUsage: [], execution: null, parallel: { executionStatus: "partial", tasks: [] } }), { status: 200 }) : base(url, options));
  const report = await evaluateDemo("http://localhost:3100", { caseId: "DEMO-001", run: true }, request);
  expect(report.cases[0]).toMatchObject({ status: "failed", httpStatus: 200, executionStatus: "partial" });
  expect(report.passed).toBe(false);
});

it.each(["release", "counts"])("does not pass when %s change during a run", async (changed) => {
  const base = fixture(); let executed = false;
  const request = vi.fn(async (url: URL, options?: RequestInit) => {
    if (url.pathname === "/api/route") executed = true;
    if (executed && url.pathname === "/api/release" && changed === "release") return new Response(JSON.stringify({ releaseId: requestId, buildId: "different-build", sourceCommit: "local" }));
    if (executed && url.pathname === "/api/state" && changed === "counts") return new Response(JSON.stringify({ backend: "postgres", writesPaused: false, postgres: { prepared: true, counts: { tickets: 3, approvals: 1 } } }));
    return base(url, options);
  });
  const report = await evaluateDemo("http://localhost:3100", { caseId: "DEMO-003", run: true }, request);
  expect(report.cases[0]).toMatchObject({ status: "passed" });
  expect(report.passed).toBe(false);
  if (changed === "release") expect(report.runtimeStable).toBe(false);
  else expect(report.businessCountsUnchanged).toBe(false);
});