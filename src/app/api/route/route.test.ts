import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeSkill, inferIntent, submitApproval, approvalDetails, auditBegin, auditFinish } = vi.hoisted(() => ({ executeSkill: vi.fn(), inferIntent: vi.fn(), submitApproval: vi.fn(), approvalDetails: vi.fn(), auditBegin: vi.fn(), auditFinish: vi.fn() }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin: auditBegin, finish: auditFinish }, getAudit: vi.fn() }));
vi.mock("../../../lib/esp/executor", () => ({ executeSkill }));
vi.mock("../../../lib/esp/approval-workflow", () => ({ submitApproval, approvalDetails }));
vi.mock("../../../lib/esp/intent-model", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/esp/intent-model")>(), inferIntent,
}));

import { POST } from "./route";
import { modelRateLimit } from "../../../lib/esp/model-rate-limit";
import { KnowledgeVerificationError } from "../../../lib/esp/knowledge-grounding";
import { knowledgeVerificationReasonSchema } from "../../../lib/esp/contracts";
import { knowledgeDocuments } from "../../../lib/esp/knowledge-corpus";
import { parallelReadResultSchema } from "../../../lib/esp/parallel-read-contracts";
import { workflowResponseSchema } from "../../../lib/esp/workflow-contracts";
import { executeConfirmedTicket, prepareTicketConfirmation, TicketConfirmationError } from "../../../lib/esp/ticket-confirmation";
vi.mock("../../../lib/esp/ticket-confirmation", async (original) => ({ ...await original<typeof import("../../../lib/esp/ticket-confirmation")>(), executeConfirmedTicket: vi.fn(), prepareTicketConfirmation: vi.fn() }));
beforeEach(() => {
  vi.mocked(prepareTicketConfirmation).mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", expiresAt: "2026-09-14T00:15:00Z", ticketId: "ESP-20260914-33333333" });
  vi.mocked(executeConfirmedTicket).mockImplementation(async (id, query, details, identity, dependencies) => {
    if (!id) throw new TicketConfirmationError("CONFIRMATION_REQUIRED", 409);
    const execution = await dependencies!.execute!("create-it-ticket", query, identity.subject!, {}, details);
    if (execution.type !== "ticket_created") throw new Error("Invalid ticket");
    return { execution, receiptReused: false };
  });
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function ticketRequest(confirmed: boolean) {
  return new Request("http://localhost/api/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "create ticket for broken laptop", confirmed, ...(confirmed ? { confirmationId: "33333333-3333-4333-8333-333333333333" } : {}), parameters: { description: "Laptop fails to start", impact: "individual" } }),
  });
}

describe("POST /api/route", () => {
  it("requires server-issued confirmation before an individual ticket write", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const body = await ticketRequest(true).json(); delete body.confirmationId;
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "CONFIRMATION_REQUIRED", skillUsage: [expect.objectContaining({ invoked: false })] });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("reports recovered confirmation receipts without another invocation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(executeConfirmedTicket).mockResolvedValue({ execution: { type: "ticket_created", ticket: { id: "ESP-20260914-33333333", status: "open", summary: "VPN", createdAt: "2026-09-14T00:00:00Z", createdBy: "development:local" } }, receiptReused: true });
    const body = await (await POST(ticketRequest(true))).json();
    expect(body).toMatchObject({ executionStatus: "completed", skillUsage: [expect.objectContaining({ invoked: false, receiptReused: true })] });
    expect(executeSkill).not.toHaveBeenCalled();
  });
  it.each(["confirmed", "parameters", "permission", "subject"])("does not execute a model-selected workflow with incompatible %s", async (mode) => {
    vi.stubEnv("NODE_ENV", "development");
    const query = "先查工单，再根据工单背景查询 IT 处理规范。";
    inferIntent.mockResolvedValue({ decision: "workflow", skillId: null, candidateIds: [], question: null, description: null, device: null, impact: null, impactEvidence: null, ticketId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query });
    if (mode === "permission") vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read");
    const principal = Buffer.from(JSON.stringify({ role_typ: "roles", claims: [{ typ: "roles", val: "tickets.read" }, { typ: "roles", val: "knowledge.read" }] })).toString("base64");
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", headers: mode === "subject" ? { "x-ms-client-principal": principal } : {}, body: JSON.stringify({ query, confirmed: mode === "confirmed", ...(mode === "parameters" ? { parameters: {} } : {}) }) }));
    expect((await response.json()).route.status).toBe("no_match");
    expect(executeSkill).not.toHaveBeenCalled(); expect(submitApproval).not.toHaveBeenCalled();
    expect(inferIntent).toHaveBeenCalledWith(expect.objectContaining({ allowWorkflow: false }));
  });

  it.each(["completed", "partial", "not_found", "needs_input", "failed"])("automatically executes the fixed workflow with outcome %s", async (outcome) => {
    vi.stubEnv("NODE_ENV", "development");
    const query = outcome === "needs_input" ? "先查询工单，再根据工单背景查询 IT 处理规范。" : "先查询工单 ESP-20260911-03CE94E1，再根据工单背景查询 IT 处理规范。";
    inferIntent.mockResolvedValue({ decision: "workflow", skillId: null, candidateIds: [], question: null, description: null, device: null, impact: null, impactEvidence: null, ticketId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query });
    const ticket = { type: "ticket_status", ticket: { id: "ESP-20260911-03CE94E1", status: "open", summary: "VPN 客户端连接失败", createdBy: "development:local", createdAt: "2026-09-11T00:00:00Z" } };
    const source = knowledgeDocuments.find((document) => document.skillId === "search-software-catalog")!;
    executeSkill.mockImplementation(async (skillId) => {
      if (skillId === "get-ticket-status") {
        if (outcome === "failed") throw new Error("private failure");
        return outcome === "not_found" ? { type: "ticket_not_found", ticketId: ticket.ticket.id } : outcome === "needs_input" ? { type: "input_required", field: "ticketId" } : ticket;
      }
      if (outcome === "partial") throw new KnowledgeVerificationError("incomplete");
      return { type: "knowledge_answer", corpus: "dev-samples", answer: "模拟规范：核对受管客户端。", citations: [{ ...source, url: `/knowledge/${source.id}`, excerpt: source.content.slice(0, 100) }] };
    });
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query, confirmed: false }) }));
    const body = await response.json(); const parsed = workflowResponseSchema.parse(body);
    expect(response.status).toBe(outcome === "failed" ? 502 : 200);
    expect(body.route.status).toBe("workflow"); expect(parsed.workflow.executionStatus).toBe(outcome);
    expect(body.skillUsage.every((entry: { selectionSource: string }) => entry.selectionSource === "model")).toBe(true);
    expect(executeSkill.mock.calls.map((call) => call[0])).toEqual(["completed", "partial"].includes(outcome) ? ["get-ticket-status", "search-software-catalog"] : ["get-ticket-status"]);
    expect(submitApproval).not.toHaveBeenCalled();
    expect(auditFinish).toHaveBeenCalledWith(expect.objectContaining({ requestId: body.requestId, requiredPermissions: expect.arrayContaining(["knowledge.read", "tickets.read"]), references: expect.arrayContaining([{ type: "skill", id: "search-software-catalog", version: "0.1.0" }]) }), "development:local");
  });

  it("automatically executes all three screenshot questions without selecting a skill or using cue words", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const questions = ["北京出差住宿上限是多少元每人每晚？", "连续4个工作日年假需提前几天申请？", "查询工单 ESP-20260911-03CE94E1 的状态。"];
    inferIntent.mockResolvedValue({
      decision: "parallel", skillId: null, candidateIds: [], question: null,
      description: null, device: null, impact: null, impactEvidence: null, ticketId: null,
      parallelEvidence: questions.join(" "), tasks: questions.map((query, index) => ({ skillId: ["search-expense-policy", "search-company-policy", "get-ticket-status"][index], query })),
    });
    executeSkill.mockImplementation(async (skillId) => {
      if (skillId === "get-ticket-status") return { type: "ticket_status", ticket: { id: "ESP-20260911-03CE94E1", status: "open", summary: "Simulated VPN issue", createdAt: "2026-09-11T00:00:00.000Z", createdBy: "development:local" } };
      const source = knowledgeDocuments.find((document) => document.skillId === skillId)!;
      return { type: "knowledge_answer", corpus: "dev-samples", answer: "Simulated policy result.", citations: [{ ...source, url: `/knowledge/${source.id}`, excerpt: source.content.slice(0, 100) }] };
    });
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: questions.join(" "), confirmed: false }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ executionStatus: "completed", route: { status: "parallel" }, intent: { source: "model" } });
    expect(parallelReadResultSchema.parse(body.parallel).tasks).toHaveLength(3);
    expect(executeSkill.mock.calls.map((call) => call[1])).toEqual(questions);
    expect(body.skillUsage.every((usage: { invoked: boolean }) => usage.invoked)).toBe(true);
    expect(auditBegin).toHaveBeenCalledTimes(4);
    expect(auditFinish).toHaveBeenCalledTimes(4);
    expect(submitApproval).not.toHaveBeenCalled();
  });

  it.each(["partial", "completed", "failed", "no_result"])("returns independent read results with aggregate %s and audit references", async (outcome) => {
    vi.stubEnv("NODE_ENV", "development");
    inferIntent.mockResolvedValue({
      decision: "parallel", skillId: null, candidateIds: [], question: null,
      description: null, device: null, impact: null, impactEvidence: null, ticketId: null,
      parallelEvidence: "同时", tasks: [{ skillId: "search-company-policy", query: "年假制度" }, { skillId: "search-expense-policy", query: "北京差旅标准" }],
    });
    const source = knowledgeDocuments.find((document) => document.id === "dev-hr-leave")!;
    const answer = { type: "knowledge_answer", corpus: "dev-samples", answer: "A simulated policy result.", citations: [{ ...source, url: `/knowledge/${source.id}`, excerpt: source.content.slice(0, 100) }] };
    executeSkill.mockImplementation(async (skillId) => {
      if (outcome === "failed" || outcome === "partial" && skillId === "search-expense-policy") throw new KnowledgeVerificationError("incomplete");
      return outcome === "no_result" ? { type: "knowledge_not_found", corpus: "dev-samples" } : answer;
    });
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: "请同时查询年假制度和北京差旅标准" }) }));
    const body = await response.json();
    expect(response.status).toBe(outcome === "failed" ? 502 : 200);
    expect(body.executionStatus).toBe(outcome);
    const parallel = parallelReadResultSchema.parse(body.parallel);
    expect(parallel.tasks).toHaveLength(2);
    expect(body.skillUsage.map((entry: { skillId: string }) => entry.skillId)).toEqual(["search-company-policy", "search-expense-policy"]);
    expect(body.execution).toBeNull();
    expect(executeSkill.mock.calls.map((call) => call[1])).toEqual(["年假制度", "北京差旅标准"]);
    expect(auditBegin).toHaveBeenCalledTimes(3);
    expect(auditFinish).toHaveBeenCalledWith(expect.objectContaining({ requestId: body.requestId, status: outcome, references: expect.arrayContaining([
      { type: "skill", id: "search-company-policy", version: "0.2.0" },
      { type: "skill", id: "search-expense-policy", version: "0.1.0" },
    ]) }), "development:local");
    expect(parallel.tasks.every((task) => task.audit.traceId === body.audit.traceId)).toBe(true);
    expect(submitApproval).not.toHaveBeenCalled();
  });

  it("does not execute a parallel plan when a client sends write confirmation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    inferIntent.mockResolvedValue({
      decision: "parallel", skillId: null, candidateIds: [], question: null,
      description: null, device: null, impact: null, impactEvidence: null, ticketId: null,
      parallelEvidence: "同时", tasks: [{ skillId: "search-company-policy", query: "年假制度" }, { skillId: "search-expense-policy", query: "差旅标准" }],
    });
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: "同时查询年假制度和差旅标准", confirmed: true }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("PARALLEL_READ_PLAN_INVALID");
    expect(executeSkill).not.toHaveBeenCalled();
    expect(submitApproval).not.toHaveBeenCalled();
  });

  it("blocks a confirmed ticket write when its audit start cannot be recorded", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.spyOn(console, "error").mockImplementation(() => undefined);
    auditBegin.mockRejectedValue(new Error("Audit unavailable"));
    const response = await POST(ticketRequest(true));
    expect(response.status).toBe(503); expect((await response.json()).audit.status).toBe("unavailable"); expect(executeSkill).not.toHaveBeenCalled();
  });

  it("does not execute an unauditable write when the principal has no subject", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const principal = Buffer.from(JSON.stringify({ role_typ: "roles", claims: [{ typ: "roles", val: "tickets.create" }] })).toString("base64");
    const request = ticketRequest(true); request.headers.set("x-ms-client-principal", principal);
    const response = await POST(request);
    expect(response.status).toBe(503); expect((await response.json()).audit.status).toBe("not_recorded");
    expect(executeSkill).not.toHaveBeenCalled(); expect(auditBegin).not.toHaveBeenCalled();
  });

  it("keeps the actual ticket receipt if final audit persistence fails", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.spyOn(console, "error").mockImplementation(() => undefined);
    auditFinish.mockRejectedValue(new Error("Audit completion failed"));
    executeSkill.mockResolvedValue({ type: "ticket_created", ticket: { id: "ESP-20260911-12345678", status: "open", summary: "Device test", createdAt: "2026-09-11T00:00:00.000Z", createdBy: "development:local" } });
    const response = await POST(ticketRequest(true)); const body = await response.json();
    expect(response.status).toBe(200); expect(body.executionStatus).toBe("completed"); expect(body.audit.status).toBe("incomplete"); expect(executeSkill).toHaveBeenCalledTimes(1);
  });

  it.each(["team", "organization"])("does not bypass %s review with confirmed=true", async (impact) => {
    vi.stubEnv("NODE_ENV", "development");
    submitApproval.mockResolvedValue({ record: { id: "approval-test", status: "pending" }, etag: "v1" });
    approvalDetails.mockReturnValue({ record: { id: "approval-test", status: "pending" }, etag: "v1" });
    const submissionId = "e5ac7657-7bb1-4268-a75b-44c234c71931";
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({
      query: "Create simulated team outage ticket", selectedSkillId: "create-it-ticket", confirmed: true, submissionId,
      parameters: { description: "Simulated service failure", impact },
    }) }));
    const body = await response.json();
    expect(body).toMatchObject({ executionStatus: "waiting_approval", execution: null, policy: { effect: "approval" }, approval: { record: { status: "pending" } } });
    expect(body.skillUsage).toEqual([expect.objectContaining({ skillId: "create-it-ticket", invoked: false, receiptReused: false, executionStatus: "waiting_approval" })]);
    expect(submitApproval).toHaveBeenCalledWith("Create simulated team outage ticket", { description: "Simulated service failure", impact }, submissionId, expect.objectContaining({ subject: "development:local" }));
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("shows the policy decision without submitting on an unconfirmed high-impact request", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: "create ticket", confirmed: false, parameters: { description: "Simulated failure", impact: "team" } }) }));
    expect(await response.json()).toMatchObject({ executionStatus: "waiting_confirmation", policy: { effect: "approval" }, approval: null });
    expect(submitApproval).not.toHaveBeenCalled(); expect(executeSkill).not.toHaveBeenCalled();
  });

  it("does not fall back to direct execution when approval persistence fails", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.spyOn(console, "error").mockImplementation(() => {});
    submitApproval.mockRejectedValue(new Error("Storage failed"));
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: "create ticket", confirmed: true, parameters: { description: "Simulated failure", impact: "organization" } }) }));
    const body = await response.json();
    expect(response.status).toBe(502); expect(body.error).toBe("APPROVAL_SERVICE_FAILED"); expect(executeSkill).not.toHaveBeenCalled();
    expect(body.skillUsage).toEqual([expect.objectContaining({ skillId: "create-it-ticket", invoked: false, receiptReused: false, executionStatus: "failed" })]);
  });

  it("distinguishes a returned completed approval receipt from a new skill invocation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const ticket = { id: "ESP-20260913-ABCDEF12", status: "open", summary: "Existing simulated request", createdAt: "2026-09-13T00:00:00.000Z", createdBy: "development:local" };
    const stored = { record: { id: "approval-test", status: "completed", ticket }, etag: "v2" };
    submitApproval.mockResolvedValue(stored); approvalDetails.mockReturnValue(stored);
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({
      query: "Create simulated team ticket", selectedSkillId: "create-it-ticket", confirmed: true,
      parameters: { description: "Existing simulated request", impact: "team" },
    }) }));
    const body = await response.json();
    expect(body.execution.ticket.id).toBe(ticket.id);
    expect(body.skillUsage).toEqual([expect.objectContaining({ skillId: "create-it-ticket", invoked: false, receiptReused: true, executionStatus: "completed" })]);
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("does not execute an unconfirmed write skill", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await POST(ticketRequest(false));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.executionStatus).toBe("waiting_confirmation");
    expect(body.execution).toBeNull();
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("reports a selected ticket skill without claiming an invocation before confirmation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const body = await (await POST(ticketRequest(false))).json();
    expect(body.skillUsage).toEqual([expect.objectContaining({
      skillId: "create-it-ticket", name: "创建 IT 工单", version: "0.1.0",
      invoked: false, receiptReused: false, executionStatus: "waiting_confirmation",
      plugin: expect.objectContaining({ id: "tickets", operationId: "tickets.create", effect: "write" }),
    })]);
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("keeps the selected knowledge skill and invocation status when execution fails", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    executeSkill.mockRejectedValue(new Error("Knowledge unavailable"));
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST", body: JSON.stringify({ query: "Beijing hotel policy", selectedSkillId: "search-expense-policy" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.skillUsage).toEqual([expect.objectContaining({
      skillId: "search-expense-policy", name: "差旅与报销查询", selectionSource: "selection",
      invoked: true, receiptReused: false, executionStatus: "failed",
      plugin: expect.objectContaining({ id: "knowledge", operationId: "knowledge.answer", effect: "read" }),
    })]);
    expect(body.skillUsage).toHaveLength(1);
    expect(executeSkill).toHaveBeenCalledOnce();
  });

  it.each(knowledgeVerificationReasonSchema.options)("reports the safe %s factual verification reason without returning a draft", async (reason) => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    executeSkill.mockRejectedValue(new KnowledgeVerificationError(reason, "Private rejected draft or provider response"));
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST", body: JSON.stringify({ query: "Leave and attendance policy", selectedSkillId: "search-company-policy" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(body).toMatchObject({ error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: reason, executionStatus: "failed", audit: { status: "recorded" } });
    expect(body.skillUsage).toEqual([expect.objectContaining({ skillId: "search-company-policy", invoked: true, executionStatus: "failed" })]);
    expect(body.trace.at(-1).step).toBe(`knowledge.verification.${reason}`);
    expect(body).not.toHaveProperty("execution");
    expect(body).not.toHaveProperty("retryAfterSeconds");
    expect(JSON.stringify(body) + JSON.stringify(log.mock.calls)).not.toContain("Private rejected draft");
    expect(auditFinish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "KNOWLEDGE_VERIFICATION_FAILED", trace: expect.arrayContaining([{ step: `knowledge.verification.${reason}`, at: expect.any(String) }]) }), "development:local");
    expect(executeSkill).toHaveBeenCalledOnce();
  });

  it("returns the result of a confirmed write skill", async () => {
    vi.stubEnv("NODE_ENV", "development");
    executeSkill.mockResolvedValue({
      type: "ticket_created",
      ticket: {
        id: "ESP-20260910-ABCDEF12",
        status: "open",
        summary: "create ticket for broken laptop",
        createdAt: "2026-09-10T08:00:00.000Z",
        createdBy: "development:local",
      },
    });

    const response = await POST(ticketRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.executionStatus).toBe("completed");
    expect(body.execution.ticket.id).toBe("ESP-20260910-ABCDEF12");
    expect(body.skillUsage).toEqual([expect.objectContaining({ skillId: "create-it-ticket", invoked: true, receiptReused: false, executionStatus: "completed" })]);
    expect(body.trace.at(-1).step).toBe("execution.completed");
    expect(body.audit).toMatchObject({ status: "recorded", requestId: body.requestId });
    expect(auditFinish).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", references: expect.arrayContaining([{ type: "ticket", id: "ESP-20260910-ABCDEF12" }]) }), "development:local");
    expect(inferIntent).not.toHaveBeenCalled();
    expect(executeSkill).toHaveBeenCalledWith("create-it-ticket", "create ticket for broken laptop", "development:local", {}, {
      description: "Laptop fails to start", impact: "individual",
    });
  });

  it.each([
    [{ type: "input_required", field: "ticketId" }, "needs_input"],
    [{ type: "ticket_not_found", ticketId: "ESP-20260910-ABCDEF12" }, "not_found"],
    [{ type: "unavailable", skillId: "search-company-policy" }, "unavailable"],
    [{ type: "knowledge_not_found", corpus: "dev-samples" }, "no_evidence"],
  ])("maps execution result %j to %s", async (execution, status) => {
    vi.stubEnv("NODE_ENV", "development");
    executeSkill.mockResolvedValue(execution);
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST",
      body: JSON.stringify({ query: "ticket status" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.executionStatus).toBe(status);
    expect(body.execution).toEqual(execution);
    expect(body.trace.at(-1).step).toBe(`execution.${status}`);
  });

  it("returns a completed status lookup without write confirmation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const ticket = {
      id: "ESP-20260910-ABCDEF12", status: "open", summary: "Network failure",
      createdAt: "2026-09-10T10:00:00.000Z", createdBy: "development:local",
    };
    executeSkill.mockResolvedValue({ type: "ticket_status", ticket });
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST",
      body: JSON.stringify({ query: `ticket status ${ticket.id}` }),
    }));
    const body = await response.json();
    expect(body.executionStatus).toBe("completed");
    expect(body.execution.ticket).toEqual(ticket);
    expect(executeSkill).toHaveBeenCalledWith(
      "get-ticket-status", `ticket status ${ticket.id}`, "development:local",
      {}, { ticketId: ticket.id },
    );
  });

  it("reports a failed dependency rather than a successful route", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "error").mockImplementation(() => {});
    executeSkill.mockRejectedValue(new Error("Storage unavailable"));
    const response = await POST(ticketRequest(true));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.executionStatus).toBe("failed");
    expect(body.trace.at(-1).step).toBe("execution.failed");
  });

  it.each(["intent", "execution"])("preserves model throttling during %s without retrying or leaking provider details", async (stage) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("Private provider endpoint and deployment details"), {
      status: 429, code: "rate_limit_exceeded", headers: new Headers({ "retry-after": "37" }),
    });
    if (stage === "intent") inferIntent.mockRejectedValue(failure);
    else executeSkill.mockRejectedValue(failure);
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST", body: JSON.stringify(stage === "intent" ? { query: "something unclear" }
        : { query: "Beijing nightly hotel limit", selectedSkillId: "search-expense-policy" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(body).toMatchObject({ error: "MODEL_RATE_LIMITED", retryAfterSeconds: 37, executionStatus: "failed" });
    expect(JSON.stringify(body)).not.toMatch(/Private provider|endpoint and deployment/);
    expect(stage === "intent" ? inferIntent : executeSkill).toHaveBeenCalledOnce();
    if (stage === "intent") expect(executeSkill).not.toHaveBeenCalled();
  });

  it.each([
    { headers: { "retry-after-ms": "1250" }, expected: 2 },
    { headers: { "x-ms-retry-after-ms": "2500" }, expected: 3 },
    { headers: { "retry-after": "Sun, 13 Sep 2026 00:00:40 GMT" }, expected: 40 },
    { headers: { "retry-after": "invalid" }, expected: 60 },
    { headers: { "retry-after": "999999999" }, expected: 60 },
    { headers: { "retry-after": "0" }, expected: 1 },
    { headers: {}, expected: 60 },
  ])("normalizes model retry metadata safely: $headers", ({ headers, expected }) => {
    const failure = Object.assign(new Error("Provider detail"), { status: 429, code: "rate_limit_exceeded", headers: new Headers(headers as Record<string, string>) });
    expect(modelRateLimit(failure, Date.parse("2026-09-13T00:00:00Z"))).toEqual({ retryAfterSeconds: expected });
  });

  it("does not label other HTTP errors or storage throttling as a model limit", () => {
    expect(modelRateLimit(new Error("Something else"))).toBeNull();
    expect(modelRateLimit(Object.assign(new Error("Storage throttled"), { status: 429, code: "TooManyRequests" }))).toBeNull();
    expect(modelRateLimit(Object.assign(new Error("Model failure"), { status: 500, code: "rate_limit_exceeded" }))).toBeNull();
  });

  it("asks for missing ticket fields even when confirmed is sent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST", body: JSON.stringify({ query: "create ticket", confirmed: true, parameters: {} }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.executionStatus).toBe("needs_input");
    expect(body.execution.missingFields).toEqual(["description", "impact"]);
    expect(body.skillUsage).toEqual([expect.objectContaining({ skillId: "create-it-ticket", invoked: false, executionStatus: "needs_input" })]);
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("asks for intent selection without executing either candidate", async () => {
    vi.stubEnv("NODE_ENV", "development");
    inferIntent.mockResolvedValue({
      decision: "clarify", skillId: null, candidateIds: ["search-company-policy", "search-expense-policy"], question: "Which policy?",
      description: null, device: null, impact: null, impactEvidence: null, ticketId: null,
    });
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST", body: JSON.stringify({ query: "leave policy and expense policy" }),
    }));
    const body = await response.json();
    expect(body.executionStatus).toBe("needs_input");
    expect(body.execution.type).toBe("intent_clarification");
    expect(body.execution.choices).toHaveLength(2);
    expect(body.skillUsage).toEqual([]);
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("validates a selected skill against current permissions", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
    const response = await POST(new Request("http://localhost/api/route", {
      method: "POST", body: JSON.stringify({ query: "Help", selectedSkillId: "create-it-ticket", confirmed: true, parameters: { description: "Laptop broken", impact: "team" } }),
    }));
    const body = await response.json();
    expect(body.executionStatus).toBe("not_routed");
    expect(body.skillUsage).toEqual([]);
    expect(executeSkill).not.toHaveBeenCalled();
    expect(inferIntent).not.toHaveBeenCalled();
  });

  it("exposes interpretation failures distinctly from execution failures", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "error").mockImplementation(() => {});
    inferIntent.mockRejectedValue(new Error("Model unavailable"));
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: "something unclear" }) }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error).toBe("INTENT_UNAVAILABLE");
    expect(body.skillUsage).toEqual([]);
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("rejects malformed parameters without consulting the model", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ query: "create ticket", parameters: { impact: "urgent" } }) }));
    expect(response.status).toBe(400);
    expect(inferIntent).not.toHaveBeenCalled();
    expect(executeSkill).not.toHaveBeenCalled();
  });
});