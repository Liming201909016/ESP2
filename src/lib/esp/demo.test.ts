import { describe, expect, it } from "vitest";
import { checkDemoResult, demoBlockers, demoCases, demoRequest, loadDemoPreflight, type DemoPreflight } from "./demo";
import { demoMessages, demoOriginalLabel, demoText } from "./demo-locale";

const ticketId = "ESP-20260911-03CE94E1";
const now = Date.parse("2026-09-14T02:00:00Z");
const preflight: DemoPreflight = {
  checkedAt: new Date(now).toISOString(), release: null, errors: ["release"], state: { backend: "postgres", writesPaused: false, postgres: { prepared: true, counts: { tickets: 1, approvals: 0 } } },
  plugins: [{ id: "knowledge", dependencies: [{ id: "foundry", configured: true }] }, { id: "tickets", dependencies: [] }],
  readiness: { status: "ready", validUntil: new Date(now + 60_000).toISOString(), checks: { blob: { status: "healthy" }, search: { status: "healthy" }, state: { status: "healthy" } } },
  skills: [
    { id: "search-company-policy", name: "HR", knowledgeBase: { id: "enterprise", indexName: "esp-knowledge-dev-v1" }, sources: [{ id: "dev-hr-leave" }] },
    { id: "search-expense-policy", name: "Finance", knowledgeBase: { id: "finance", indexName: "esp-finance-dev-v1" }, sources: [{ id: "dev-travel-approval" }] },
    { id: "get-ticket-status", name: "Ticket", sources: [] },
  ], tickets: [{ id: ticketId, status: "open", summary: "Simulated VPN request" }],
};

describe("fixed demonstration cases", () => {
  it("translates known preflight blockers without changing requests or fixture data", () => {
    const before = JSON.stringify({ preflight, demoCases });
    const broken = { ...preflight, errors: ["catalog", "tickets", "state"] as DemoPreflight["errors"], plugins: [], skills: [], state: null, readiness: null };
    const reasons = [...demoBlockers(demoCases[0], null), ...demoBlockers(demoCases[1], broken, undefined, now)];
    for (const original of [...reasons, ...demoCases.map((entry) => entry.title)]) {
      expect(demoOriginalLabel("zh-CN", original)).toBe(original);
      expect(demoOriginalLabel("en-US", original)).not.toMatch(/[\u4e00-\u9fff]/);
    }
    for (const pair of Object.values(demoMessages)) expect(pair.every((value) => value.trim())).toBe(true);
    for (const original of ["unknown", "__proto__", "toString"]) expect(demoOriginalLabel("en-US", original)).toBe(original);
    expect(demoText("en-US", "configured")).toContain("Not probed");
    expect(JSON.stringify({ preflight, demoCases })).toBe(before);
  });
  it("creates only unselected, unconfirmed requests and never invents a ticket", () => {
    for (const selected of demoCases) {
      const request = demoRequest(selected.id, selected.requiresTicket ? ticketId : undefined);
      expect(Object.keys(request)).toEqual(["query", "confirmed"]);
      expect(request.confirmed).toBe(false);
      expect(request.query).not.toMatch(/同时|分别|创建工单/);
    }
    expect(() => demoRequest("DEMO-002")).toThrow();
    expect(() => demoRequest("DEMO-002", "unknown")).toThrow();
    expect(() => demoRequest("unknown")).toThrow();
  });

  it("requires available current-owner tickets, permissions, sources and distinct knowledge bases", () => {
    expect(demoBlockers(demoCases[1], preflight, ticketId, now)).toEqual([]);
    expect(demoBlockers(demoCases[1], preflight, undefined, now)).toContain("请选择当前身份可访问的工单");
    expect(demoBlockers(demoCases[1], { ...preflight, state: null }, ticketId, now)).toContain("工单事务状态未确认");
    expect(demoBlockers(demoCases[0], { ...preflight, skills: [] }, undefined, now)).toContain("当前身份缺少场景所需技能");
    const wrong = structuredClone(preflight); wrong.skills[1].knowledgeBase!.id = "enterprise";
    expect(demoBlockers(demoCases[0], wrong, undefined, now)).toContain("财务知识库绑定不符");
  });

  it("never treats failed or stale dependency checks as ready", () => {
    expect(demoBlockers(demoCases[0], null)).toEqual(["尚未完成自检"]);
    expect(demoBlockers(demoCases[0], preflight, undefined, now + 61_000)).toContain("自检已过期，请重新检查");
    expect(demoBlockers(demoCases[0], { ...preflight, readiness: null }, undefined, now)).toContain("依赖尚未就绪");
    expect(demoBlockers(demoCases[0], { ...preflight, plugins: [] }, undefined, now)).toContain("模型配置缺失或未确认");
  });

  it("isolates failed preflight endpoints without model or mutation requests", async () => {
    const paths: string[] = [];
    const result = await loadDemoPreflight(async (path) => { paths.push(path); throw new Error("secret internal error"); });
    expect(paths.sort()).toEqual(["/api/plugins", "/api/readiness", "/api/release", "/api/skills", "/api/state", "/api/tickets"]);
    expect(result.errors).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("accepts clarification but rejects incomplete or fabricated skill usage", () => {
    const result = { requestId: "11111111-1111-4111-8111-111111111111", executionStatus: "needs_input", route: { status: "no_match" }, skillUsage: [], execution: { type: "intent_clarification" } };
    expect(checkDemoResult(demoCases[2], result).status).toBe("needs_input");
    expect(() => checkDemoResult(demoCases[0], result)).toThrow("DEMO_SKILL_MISMATCH");
    expect(() => checkDemoResult(demoCases[2], { ...result, executionStatus: "failed" })).toThrow("DEMO_CLARIFICATION_MISMATCH");
  });

  it("requires complete, correctly bound task evidence instead of aggregate counts alone", () => {
    const tasks = demoCases[0].skills.map((skillId, index) => ({
      usage: { skillId, invoked: true, receiptReused: false, executionStatus: "completed", plugin: { id: "knowledge", operationId: "knowledge.answer", effect: "read" }, knowledgeBase: { id: index === 0 ? "finance" : "enterprise" } },
      executionStatus: "completed", execution: { type: "knowledge_answer", answer: index === 0 ? "模拟住宿上限600元/人/晚。" : "模拟休假申请至少提前7个工作日。", citations: [{ id: index === 0 ? "dev-travel-approval" : "dev-hr-leave", excerpt: "经过核对的模拟原文片段", url: index === 0 ? "/knowledge/dev-travel-approval" : "/knowledge/dev-hr-leave" }] },
    }));
    const result = { requestId: "11111111-1111-4111-8111-111111111111", route: { status: "parallel" }, executionStatus: "completed", execution: null, skillUsage: tasks.map((task) => task.usage), parallel: { executionStatus: "completed", tasks } };
    expect(checkDemoResult(demoCases[0], result).status).toBe("completed");
    expect(() => checkDemoResult(demoCases[0], { ...result, executionStatus: "partial" })).toThrow("DEMO_PARALLEL_INCOMPLETE");
    const swapped = structuredClone(result);
    swapped.skillUsage[0].knowledgeBase.id = "enterprise";
    expect(() => checkDemoResult(demoCases[0], swapped)).toThrow("DEMO_KNOWLEDGE_BASE_MISMATCH");
    const failure = structuredClone(result); failure.parallel.tasks[1].executionStatus = "failed";
    expect(() => checkDemoResult(demoCases[0], failure)).toThrow("DEMO_TASK_MISMATCH");
    const noQuote = structuredClone(result); noQuote.parallel.tasks[0].execution.citations = [];
    expect(() => checkDemoResult(demoCases[0], noQuote)).toThrow("DEMO_EVIDENCE_MISMATCH");
  });
});