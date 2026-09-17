import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { knowledgeMissingReasonSchema, knowledgeVerificationReasonSchema, skillUsageResponseSchema, type SkillUsageResponse } from "../lib/esp/contracts";
import { SkillUsagePanel } from "./skill-usage";
import { knowledgeMissingMessage, knowledgeVerificationMessage } from "./knowledge-feedback";
import { ParallelReadResults } from "./parallel-results";
import { parallelReadResultSchema, type ParallelReadResult } from "../lib/esp/parallel-read-contracts";
import { WorkflowResults } from "./workflow-panel";
import { ticketGuidanceQuery, ticketGuidanceWorkflow, workflowResponseSchema } from "../lib/esp/workflow-contracts";
import { LocaleProvider } from "./locale-provider";
import type { Locale } from "../lib/esp/locale";

function renderToStaticMarkup(node: ReactNode, locale: Locale = "zh-CN") {
  return renderMarkup(createElement(LocaleProvider, { initialLocale: locale }, node));
}

const report: SkillUsageResponse = {
  requestId: "11111111-1111-4111-8111-111111111111",
  skillUsage: [{
    skillId: "search-expense-policy", name: "差旅与报销查询", description: "核对差旅费用标准与有日期的合成台账。", version: "0.1.0", category: "knowledge", riskLevel: "low",
    selectionSource: "model", matchedKeywords: [], invoked: true, receiptReused: false, executionStatus: "completed",
    plugin: { id: "knowledge", name: "Knowledge", version: "0.1.0", operationId: "knowledge.answer", operationName: "检索知识", effect: "read" },
  }],
};

function render(value: SkillUsageResponse | null, options: { pending?: boolean; failed?: boolean; responseReceived?: boolean; awaitingSelection?: boolean } = {}) {
  return renderToStaticMarkup(createElement(SkillUsagePanel, { report: value, pending: false, failed: false, awaitingSelection: false, onOpenSkill: vi.fn(), onOpenPlugin: vi.fn(), ...options }));
}

describe("workbench skill usage", () => {
  it("renders English invocation labels while retaining registry metadata", () => {
    const value = structuredClone(report);
    Object.assign(value.skillUsage[0], { invoked: false, receiptReused: true });
    const before = JSON.stringify(value);
    const html = renderToStaticMarkup(createElement(SkillUsagePanel, { report: value, pending: false, failed: false, awaitingSelection: false, onOpenSkill: vi.fn(), onOpenPlugin: vi.fn() }), "en-US");
    expect(html).toContain("Existing receipt reused");
    expect(html).toContain("Not invoked · Existing receipt returned");
    expect(html).toContain("Invoked Skills <strong>0</strong>");
    expect(html).toContain("Original registry metadata");
    expect(html).toContain(value.skillUsage[0].description);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("shows the server-owned knowledge base without inferring one for older responses", () => {
    const value = structuredClone(report);
    value.skillUsage[0].knowledgeBase = { id: "finance", name: "财务差旅知识库", indexName: "esp-finance-dev-v1" };
    expect(render(value)).toContain("财务差旅知识库");
    expect(render(report)).not.toContain("绑定知识库");
  });

  it("names the adopted skill and its actual bound plugin operation", () => {
    const markup = render(report);
    expect(markup).toContain("本次技能使用情况");
    expect(markup).toContain("差旅与报销查询");
    expect(markup).toContain("search-expense-policy");
    expect(markup).toContain("knowledge.answer");
    expect(markup).toContain("AI 语义识别");
    expect(markup).toContain("已发起调用");
    expect(markup).toContain("技能详情");
    expect(markup).toContain("插件详情");
    expect(markup).toContain("已调用技能 <strong>1</strong>");
  });

  it.each(["waiting_confirmation", "waiting_approval", "needs_input"] as const)("does not claim invocation in %s", (executionStatus) => {
    const value = structuredClone(report);
    Object.assign(value.skillUsage[0], { invoked: false, executionStatus });
    const markup = render(value);
    expect(markup).toContain("未调用");
    expect(markup).toContain("已调用技能 <strong>0</strong>");
    expect(markup).not.toContain("已发起调用");
  });

  it("retains a failed invoked skill rather than hiding it with the error", () => {
    const value = structuredClone(report); value.skillUsage[0].executionStatus = "failed";
    const markup = render(value, { failed: true });
    expect(markup).toContain("差旅与报销查询");
    expect(markup).toContain("已发起调用");
    expect(markup).toContain("失败");
  });

  it("does not display the previous invocation while a new request is pending", () => {
    const markup = render(report, { pending: true });
    expect(markup).toContain("等待服务端返回");
    expect(markup).not.toContain("search-expense-policy");
    expect(markup).not.toContain("已发起调用");
  });

  it("distinguishes unavailable request evidence from no selection", () => {
    expect(render(null, { failed: true })).toContain("本次调用情况未确认");
    expect(render(null, { responseReceived: true })).toContain("未收到本次技能记录");
    expect(render({ ...report, skillUsage: [] })).toContain("本次未选中可执行技能");
    expect(render({ ...report, skillUsage: [] }, { awaitingSelection: true })).toContain("候选技能待选择");
  });

  it("marks a reused receipt as not invoked again", () => {
    const value = structuredClone(report); Object.assign(value.skillUsage[0], { invoked: false, receiptReused: true });
    const markup = render(value);
    expect(markup).toContain("复用已有回执");
    expect(markup).toContain("未调用 · 返回已有回执");
  });

  it("does not invent a plugin for an unimplemented skill", () => {
    const value = structuredClone(report); Object.assign(value.skillUsage[0], { plugin: null, invoked: false, executionStatus: "unavailable" });
    expect(render(value)).toContain("未绑定");
    expect(render(value)).not.toContain("插件详情");
  });

  it("requires a request identity, unique skills and at most three usages", () => {
    expect(skillUsageResponseSchema.safeParse(report).success).toBe(true);
    expect(skillUsageResponseSchema.safeParse({ ...report, requestId: "invalid" }).success).toBe(false);
    expect(skillUsageResponseSchema.safeParse({ ...report, skillUsage: [...report.skillUsage, ...report.skillUsage] }).success).toBe(false);
    const second = { ...report.skillUsage[0], skillId: "search-company-policy" };
    expect(skillUsageResponseSchema.safeParse({ ...report, skillUsage: [...report.skillUsage, second] }).success).toBe(true);
    expect(skillUsageResponseSchema.safeParse({ ...report, skillUsage: [...report.skillUsage, second, { ...second, skillId: "search-procurement-guide" }, { ...second, skillId: "search-software-catalog" }] }).success).toBe(false);
  });

  it("retains a bounded valid failure trace without accepting arbitrary trace contents", () => {
    const trace = [{ step: "execution.rate_limited", at: "2026-09-13T09:00:00.000Z" }];
    expect(skillUsageResponseSchema.parse({ ...report, trace }).trace).toEqual(trace);
    expect(skillUsageResponseSchema.safeParse({ ...report, trace: [{ step: "Raw error body", at: "invalid" }] }).success).toBe(false);
  });
});

describe("knowledge verification feedback", () => {
  it("provides complete English reasons without echoing unknown payloads", () => {
    for (const reason of knowledgeMissingReasonSchema.options) expect(knowledgeMissingMessage(reason, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
    for (const reason of knowledgeVerificationReasonSchema.options) {
      expect(knowledgeVerificationMessage(reason, "en-US")).toContain("generated content is not shown");
      expect(knowledgeVerificationMessage(reason, "en-US")).not.toMatch(/automatically retry|service unavailable/i);
    }
    expect(knowledgeVerificationMessage("private provider body", "en-US")).not.toContain("private provider body");
    expect(knowledgeVerificationMessage("conflicting", "en-US")).toContain("possible source conflict");
    expect(knowledgeVerificationMessage("unsupported_number", "en-US")).toContain("values and units");
  });
  it("distinguishes missing evidence stages and never echoes an unknown reason", () => {
    const messages = knowledgeMissingReasonSchema.options.map((reason) => knowledgeMissingMessage(reason));
    expect(new Set(messages).size).toBe(4);
    expect(knowledgeMissingMessage("model_unsupported")).toContain("模型判断");
    expect(knowledgeMissingMessage("raw private draft")).not.toContain("raw private");
    expect(knowledgeMissingMessage(undefined)).toBe("当前资料未提供足够依据，未返回已核验答案。");
  });

  it.each(knowledgeVerificationReasonSchema.options)("explains %s without calling it an outage or automatic retry", (reason) => {
    const message = knowledgeVerificationMessage(reason);
    expect(message).toContain("本次未展示生成内容");
    expect(message).not.toMatch(/服务暂不可用|稍后重试|自动重试/);
  });

  it("distinguishes a tentative semantic verdict from malformed review output", () => {
    expect(knowledgeVerificationMessage("incomplete")).toContain("复核认为");
    expect(knowledgeVerificationMessage("conflicting")).toContain("可能的资料冲突");
    expect(knowledgeVerificationMessage("invalid_review")).toContain("格式不符合要求");
  });

  it.each([undefined, null, "Private provider output", { text: "Private generated answer" }])("does not display an unknown reason payload", (reason) => {
    expect(knowledgeVerificationMessage(reason)).toBe("答案未通过事实核验，本次未展示生成内容。请查看审计记录或核对相关原文。");
  });
});

describe("independent read result rendering", () => {
  const result: ParallelReadResult = {
    mode: "parallel_read", concurrency: 2, executionStatus: "partial", tasks: [
      {
        id: "read-1", requestId: "11111111-1111-4111-8111-111111111111", query: "北京差旅标准", usage: report.skillUsage[0], executionStatus: "completed",
        execution: { type: "knowledge_answer", corpus: "dev-samples", answer: "SIM: Beijing hotel limit 600 CNY.", citations: [{
          id: "dev-travel-approval", title: "Simulated travel policy", section: "Hotel", version: "2026.09-sim-v3", organization: "Simulation", documentNumber: "SIM-FIN-002", owner: "Finance", effectiveDate: "2026-09-01", dataKind: "policy", url: "/knowledge/dev-travel-approval", excerpt: "Beijing hotel limit is 600 CNY per person per night.",
        }] },
        startedAt: "2026-09-13T10:00:00.000Z", completedAt: "2026-09-13T10:00:01.000Z", durationMs: 1000,
        audit: { id: null, requestId: "11111111-1111-4111-8111-111111111111", traceId: "33333333-3333-4333-8333-333333333333", status: "unavailable" },
      },
      {
        id: "read-2", requestId: "22222222-2222-4222-8222-222222222222", query: "年假制度", usage: { ...report.skillUsage[0], skillId: "search-company-policy", name: "人事制度查询", executionStatus: "failed" },
        executionStatus: "failed", execution: null, error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: "incomplete",
        startedAt: "2026-09-13T10:00:00.000Z", completedAt: "2026-09-13T10:00:02.000Z", durationMs: 2000,
        audit: { id: null, requestId: "22222222-2222-4222-8222-222222222222", traceId: "33333333-3333-4333-8333-333333333333", status: "unavailable" },
      },
    ],
  };

  it("keeps a verified result and its citation next to an independently failed task", () => {
    const parsed = parallelReadResultSchema.parse(result);
    const markup = renderToStaticMarkup(createElement(ParallelReadResults, { result: parsed, busy: false, onOpenAudit: vi.fn(), onContinue: vi.fn() }));
    expect(markup).toContain("SIM: Beijing hotel limit 600 CNY.");
    expect(markup).toContain("/knowledge/dev-travel-approval");
    expect(markup).toContain("任务 1：差旅费用与预算查询");
    expect(markup).toContain("任务 2：人事制度查询");
    expect(markup).toContain("核验未通过");
    expect(markup).toContain("单独处理此项");
    expect(markup).not.toContain("确认执行");
  });
  it("renders English parallel outcomes without translating source evidence", () => {
    const parsed = parallelReadResultSchema.parse(result);
    const before = JSON.stringify(parsed);
    const html = renderToStaticMarkup(createElement(ParallelReadResults, { result: parsed, busy: false, onOpenAudit: vi.fn(), onContinue: vi.fn() }), "en-US");
    expect(html).toContain("Independent task results");
    expect(html).toContain("Original returned answer");
    expect(html).toContain("Original source text");
    expect(html).toContain("SIM: Beijing hotel limit 600 CNY.");
    expect(html).toContain("Beijing hotel limit is 600 CNY per person per night.");
    expect(html).toContain("Factual review judged the answer incomplete");
    expect(html).toContain("Handle this item separately");
    expect(html).not.toContain("Confirm execution");
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("counts multiple selections and completed versus failed calls without hiding partial results", () => {
    const markup = render({ ...report, skillUsage: result.tasks.map((task) => task.usage) });
    expect(markup).toContain("已选技能 <strong>2</strong>");
    expect(markup).toContain("已调用技能 <strong>2</strong>");
    expect(markup).toContain("已完成 <strong>1</strong>");
    expect(markup).toContain("失败 <strong>1</strong>");
  });
});

describe("dependent workflow rendering", () => {
  const rootId = "44444444-4444-4444-8444-444444444444";
  const traceId = "33333333-3333-4333-8333-333333333333";
  const audit = { id: null, requestId: rootId, traceId, status: "unavailable" };
  const ticketId = "ESP-20260911-ABCDEF12";
  const first = {
    id: "ticket", status: "not_found", query: `查询工单 ${ticketId}`, requestId: report.requestId,
    execution: { type: "ticket_not_found", ticketId },
    usage: { ...report.skillUsage[0], skillId: "get-ticket-status", name: "工单状态查询", category: "query", executionStatus: "not_found", plugin: { id: "tickets", name: "Ticket", version: "0.1.0", operationId: "tickets.get", operationName: "查询工单", effect: "read" } },
    startedAt: "2026-09-14T00:00:00.000Z", completedAt: "2026-09-14T00:00:01.000Z", durationMs: 1000,
    audit: { ...audit, requestId: report.requestId },
  };
  const skipped = { id: "guidance", status: "skipped", query: null, usage: null, execution: null, requestId: null, audit: null, startedAt: null, completedAt: null, durationMs: 0, skipReason: "upstream_not_completed" };
  function markup(steps: unknown[], executionStatus: string, locale: Locale = "zh-CN") {
    const parsed = workflowResponseSchema.parse({ audit, workflow: { requestId: rootId, workflowId: ticketGuidanceWorkflow.id, version: ticketGuidanceWorkflow.version, executionStatus, steps } });
    return renderToStaticMarkup(createElement(WorkflowResults, { result: parsed.workflow, audit: parsed.audit, onOpenAudit: vi.fn() }), locale);
  }

  it("shows skipped dependency without fabricating a second invocation", () => {
    const html = markup([first, skipped], "not_found");
    expect(html).toContain("已调用 1 / 2"); expect(html).toContain("已跳过 1");
    expect(html).toContain("前一步未返回有效工单"); expect(html).toContain("未调用");
    expect(html).not.toContain("确认执行"); expect(html).not.toContain("单独处理此项");
  });
  it("keeps skipped dependency and no-invocation semantics in English", () => {
    const html = markup([first, skipped], "not_found", "en-US");
    expect(html).toContain("Invoked 1 / 2");
    expect(html).toContain("Skipped 1");
    expect(html).toContain("The previous step returned no valid ticket; this Skill was not called.");
    expect(html).toContain("Not invoked");
    expect(html).not.toContain("Confirm execution");
  });

  it("retains the first result when dependent verification fails", () => {
    const firstSuccess = { ...first, status: "completed", usage: { ...first.usage, executionStatus: "completed" }, execution: { type: "ticket_status", ticket: { id: ticketId, status: "open", summary: "VPN 故障摘要仍应保留", createdBy: "development:local", createdAt: "2026-09-11T00:00:00Z" } } };
    const second = { ...first, id: "guidance", status: "failed", query: ticketGuidanceQuery({ ...firstSuccess.execution.ticket, status: "open" }), requestId: "22222222-2222-4222-8222-222222222222", execution: null,
      usage: { ...report.skillUsage[0], skillId: "search-software-catalog", executionStatus: "failed" },
      audit: { ...audit, requestId: "22222222-2222-4222-8222-222222222222" }, startedAt: "2026-09-14T00:00:01.000Z", completedAt: "2026-09-14T00:00:02.000Z", error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: "unsupported_number" };
    const html = markup([firstSuccess, second], "partial");
    expect(html).toContain("部分完成"); expect(html).toContain("VPN 故障摘要仍应保留");
    expect(html).toContain(knowledgeVerificationMessage("unsupported_number")); expect(html).toContain("已调用 2 / 2");
  });
});