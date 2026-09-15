import { describe, expect, it, vi } from "vitest";
import { interpretRequest } from "./intent";

function modelDraft(overrides: Record<string, unknown> = {}) {
  return {
    decision: "matched", skillId: "search-expense-policy", candidateIds: [], question: null,
    description: null, device: null, impact: null, impactEvidence: null, ticketId: null,
    ...overrides,
  };
}

describe("structured intent interpretation", () => {
  it("selects the fixed ticket-guidance workflow for a dependent natural-language request", async () => {
    const query = "先查工单 ESP-20260911-03CE94E1，再根据工单背景查询 IT 处理规范。";
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "workflow", skillId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query }));
    const result = await interpretRequest(query, ["tickets.read", "knowledge.read"], {}, infer);
    expect(result.route).toMatchObject({ status: "workflow", workflowId: "ticket-handling-guidance", version: "1.0.3" });
    expect(result.intent).toEqual({ source: "model", parameters: {} });
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({ allowWorkflow: true, allowParallel: false }));
  });

  it.each([
    "查完工单后结合工单内容给出 IT 处理指引",
    "Read ticket ESP-20260911-03CE94E1 then provide IT handling guidelines based on its contents.",
    "查询工单，根据工单背景查询 IT 处理规范。",
  ])("recognizes supported dependency wording: %s", async (query) => {
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "workflow", skillId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query }));
    expect((await interpretRequest(query, ["tickets.read", "knowledge.read"], {}, infer)).route.status).toBe("workflow");
    expect(infer).toHaveBeenCalledOnce();
  });

  it.each([
    "不要先查工单再根据结果查询 IT 规范",
    "先查工单还是根据工单背景查询 IT 规范？",
    "先查工单，如果未解决再根据结果查询 IT 规范",
    "先查工单，再根据工单背景查询 IT 规范并创建工单",
    "查询工单状态。查询 IT 软件规范。",
  ])("rejects a model workflow choice when server eligibility is absent: %s", async (query) => {
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "workflow", skillId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query }));
    const result = await interpretRequest(query, ["tickets.read", "knowledge.read", "tickets.create"], {}, infer);
    expect(result.route.status).not.toBe("workflow");
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({ allowWorkflow: false }));
  });

  it.each([
    { workflowId: "invented-workflow" }, { workflowEvidence: "an invented dependency" },
    { tasks: [{ skillId: "get-ticket-status", query: "查工单" }] },
    { candidateIds: ["get-ticket-status"] }, { description: "创建工单" }, { ticketId: "ESP-20260911-ABCDEF12" },
  ])("rejects inconsistent workflow plans: %j", async (overrides) => {
    const query = "先查工单，再根据工单背景查询 IT 规范";
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "workflow", skillId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query, ...overrides }));
    expect((await interpretRequest(query, ["tickets.read", "knowledge.read"], {}, infer)).route.status).toBe("no_match");
  });

  it("preserves explicit selection, permissions and manual fields rather than choosing a workflow", async () => {
    const query = "先查工单，再根据工单背景查询 IT 规范";
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "workflow", skillId: null, workflowId: "ticket-handling-guidance", workflowEvidence: query }));
    expect((await interpretRequest(query, ["tickets.read"], {}, infer)).route.status).toBe("no_match");
    expect(infer).toHaveBeenLastCalledWith(expect.objectContaining({ allowWorkflow: false }));
    for (const options of [{ parameters: {} }, { allowWorkflow: false }]) {
      expect((await interpretRequest(query, ["tickets.read", "knowledge.read"], options, infer)).route.status).toBe("no_match");
      expect(infer).toHaveBeenLastCalledWith(expect.objectContaining({ allowWorkflow: false }));
    }
    infer.mockClear();
    expect((await interpretRequest(query, ["tickets.read", "knowledge.read"], { selectedSkillId: "get-ticket-status" }, infer)).route.status).toBe("matched");
    expect(infer).not.toHaveBeenCalled();
  });

  it("keeps status-only fast routing and respects model clarification or outage for dependencies", async () => {
    const infer = vi.fn();
    expect((await interpretRequest("查询工单 ESP-20260911-03CE94E1 的状态", ["tickets.read", "knowledge.read"], {}, infer)).route).toMatchObject({ status: "matched", skill: { id: "get-ticket-status" } });
    expect(infer).not.toHaveBeenCalled();
    const query = "先查工单，再根据工单背景查询 IT 规范，还要查年假";
    infer.mockResolvedValue(modelDraft({ decision: "clarify", skillId: null, candidateIds: ["get-ticket-status", "search-company-policy"] }));
    const result = await interpretRequest(query, ["tickets.read", "knowledge.read"], {}, infer);
    expect(result.intent.choices).toHaveLength(2);
    infer.mockRejectedValue(new Error("Model unavailable"));
    await expect(interpretRequest(query, ["tickets.read", "knowledge.read"], {}, infer)).rejects.toThrow("Model unavailable");
  });

  it("preserves the fast path for an unambiguous knowledge request", async () => {
    const infer = vi.fn();
    const result = await interpretRequest("company leave policy", ["knowledge.read"], {}, infer);
    expect(result.route).toMatchObject({ status: "matched", skill: { id: "search-company-policy" } });
    expect(result.intent.source).toBe("keyword");
    expect(infer).not.toHaveBeenCalled();
  });

  it("matches a paraphrase only to an eligible registered skill", async () => {
    const infer = vi.fn().mockResolvedValue(modelDraft());
    const result = await interpretRequest("北京住一晚最多能花多少钱？", ["knowledge.read"], {}, infer);
    expect(result.route).toMatchObject({ status: "matched", skill: { id: "search-expense-policy" }, confidence: null });
    expect(result.intent.source).toBe("model");
    expect(infer.mock.calls[0][0].skills.every((skill: { permissions: string[] }) => skill.permissions.every((permission) => permission === "knowledge.read"))).toBe(true);
  });

  it("will not accept an invented or unauthorized model-selected skill", async () => {
    for (const skillId of ["delete-all-data", "create-it-ticket"]) {
      const result = await interpretRequest("help me do something", ["knowledge.read"], {}, vi.fn().mockResolvedValue(modelDraft({ skillId })));
      expect(result.route.status).toBe("no_match");
    }
  });

  it("retains confirmation requirements for a model-selected write", async () => {
    const result = await interpretRequest("Laptop is broken, please ask IT to help", ["tickets.create"], {}, vi.fn().mockResolvedValue(modelDraft({
      skillId: "create-it-ticket", description: "Laptop is broken", device: "Laptop",
    })));
    expect(result.route).toMatchObject({ status: "matched", requiresConfirmation: true });
    expect(result.intent.parameters).toEqual({ description: "Laptop is broken", device: "Laptop" });
  });

  it("does not fabricate missing ticket facts", async () => {
    const result = await interpretRequest("create ticket", ["tickets.create"], {}, vi.fn().mockResolvedValue(modelDraft({
      skillId: "create-it-ticket", description: "Everyone is offline", device: "SIM-LT-9999",
      impact: "organization", impactEvidence: "everyone is offline", ticketId: "ESP-20260910-ABCDEF12",
    })));
    expect(result.intent.parameters).toEqual({});
  });

  it("extracts explicit impact with supporting user text", async () => {
    const result = await interpretRequest("create ticket: Wi-Fi down, our team is affected", ["tickets.create"], {}, vi.fn().mockResolvedValue(modelDraft({
      skillId: "create-it-ticket", description: "Wi-Fi down", impact: "team", impactEvidence: "our team is affected",
    })));
    expect(result.intent.parameters).toEqual({ description: "Wi-Fi down", impact: "team" });
  });

  it("asks for a choice on an ambiguous multi-skill request", async () => {
    const result = await interpretRequest("leave policy and expense policy", ["knowledge.read"], {}, vi.fn().mockResolvedValue(modelDraft({
      decision: "clarify", skillId: null, question: "Which policy?",
      candidateIds: ["search-company-policy", "search-expense-policy", "create-it-ticket"],
    })));
    expect(result.route.status).toBe("no_match");
    expect(result.intent.choices?.map((choice) => choice.id)).toEqual(["search-company-policy", "search-expense-policy"]);
  });

  it("plans explicit independent read requests using literal per-skill questions", async () => {
    const infer = vi.fn().mockResolvedValue(modelDraft({
      decision: "parallel", skillId: null, parallelEvidence: "同时",
      tasks: [
        { skillId: "search-company-policy", query: "年假制度" },
        { skillId: "search-expense-policy", query: "北京差旅标准" },
      ],
    }));
    const result = await interpretRequest("请同时查询年假制度，以及北京差旅标准", ["knowledge.read"], {}, infer);
    expect(result.route).toMatchObject({
      status: "parallel", tasks: [
        { skill: { id: "search-company-policy" }, query: "年假制度", parameters: {} },
        { skill: { id: "search-expense-policy" }, query: "北京差旅标准", parameters: {} },
      ],
    });
    expect(result.intent.source).toBe("model");
    expect(infer).toHaveBeenCalledOnce();
  });

  it("plans the screenshot's three questions without a simultaneous keyword", async () => {
    const questions = ["北京出差住宿上限是多少元每人每晚？", "连续4个工作日年假需提前几天申请？", "查询工单 ESP-20260911-03CE94E1 的状态。"];
    const infer = vi.fn().mockResolvedValue(modelDraft({
      decision: "parallel", skillId: null, parallelEvidence: questions.join(" "),
      tasks: questions.map((query, index) => ({ skillId: ["search-expense-policy", "search-company-policy", "get-ticket-status"][index], query })),
    }));
    const result = await interpretRequest(questions.join(" "), ["knowledge.read", "tickets.read"], {}, infer);
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({ allowParallel: true }));
    expect(result.route).toMatchObject({ status: "parallel", tasks: [
      { skill: { id: "search-expense-policy" }, query: questions[0], parameters: {} },
      { skill: { id: "search-company-policy" }, query: questions[1], parameters: {} },
      { skill: { id: "get-ticket-status" }, query: questions[2], parameters: { ticketId: "ESP-20260911-03CE94E1" } },
    ] });
  });

  it.each([
    { query: "年假制度还是北京差旅标准", evidence: "还是", tasks: ["search-company-policy", "search-expense-policy"] },
    { query: "只查年假制度，不要查询北京差旅标准", evidence: "年假制度", tasks: ["search-company-policy", "search-expense-policy"] },
    { query: "不要查询年假制度。查询北京差旅标准。", evidence: "年假制度", tasks: ["search-company-policy", "search-expense-policy"] },
    { query: "如果年假制度允许，再查询北京差旅标准", evidence: "年假制度", tasks: ["search-company-policy", "search-expense-policy"] },
    { query: "不要同时查询年假制度和北京差旅标准", evidence: "同时", tasks: ["search-company-policy", "search-expense-policy"] },
    { query: "同时查年假制度，然后根据结果查询北京差旅标准", evidence: "同时", tasks: ["search-company-policy", "search-expense-policy"] },
    { query: "同时查询年假制度和北京差旅标准，再创建工单", evidence: "同时", tasks: ["search-company-policy", "create-it-ticket"] },
    { query: "同时查询年假制度和北京差旅标准", evidence: "同时", tasks: ["search-company-policy", "search-company-policy"] },
    { query: "同时查询年假制度和北京差旅标准", evidence: "同时", tasks: ["search-company-policy", "unregistered-skill"] },
  ])("does not run an ambiguous, dependent, write or invalid plan: $query / $tasks", async ({ query, evidence, tasks }) => {
    const result = await interpretRequest(query, ["knowledge.read", "tickets.create"], {}, vi.fn().mockResolvedValue(modelDraft({
      decision: "parallel", skillId: null, parallelEvidence: evidence,
      tasks: tasks.map((skillId, index) => ({ skillId, query: index === 0 ? "年假制度" : "北京差旅标准" })),
    })));
    expect(result.route.status).toBe("no_match");
  });

  it("rejects a rewritten or overlapping task without executing a valid subset", async () => {
    for (const taskQuery of ["去北京可以报销多少钱", "年假制度和北京差旅标准"]) {
      const result = await interpretRequest("同时查询年假制度和北京差旅标准", ["knowledge.read"], {}, vi.fn().mockResolvedValue(modelDraft({
        decision: "parallel", skillId: null, parallelEvidence: "同时",
        tasks: [{ skillId: "search-company-policy", query: "年假制度" }, { skillId: "search-expense-policy", query: taskQuery }],
      })));
      expect(result.route.status).toBe("no_match");
    }
  });

  it.each([
    "年假有几天？北京住一晚最多多少钱？",
    "年假有几天；北京住一晚最多多少钱",
    "年假有几天\n北京住一晚最多多少钱",
    "查询年假有几天和北京住一晚最多多少钱",
  ])("routes multiple questions semantically even with only one keyword-matched skill: %s", async (query) => {
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "parallel", skillId: null, parallelEvidence: query,
      tasks: [{ skillId: "search-company-policy", query: "年假有几天" }, { skillId: "search-expense-policy", query: "北京住一晚最多多少钱" }],
    }));
    const result = await interpretRequest(query, ["knowledge.read"], {}, infer);
    expect(result.route.status).toBe("parallel");
    expect(infer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ allowParallel: true }));
  });

  it("keeps leave and attendance in one HR skill after semantic review", async () => {
    const infer = vi.fn().mockResolvedValue(modelDraft({ skillId: "search-company-policy" }));
    const result = await interpretRequest("公司的年假和考勤规则", ["knowledge.read"], {}, infer);
    expect(result.route).toMatchObject({ status: "matched", skill: { id: "search-company-policy" } });
    expect(infer).toHaveBeenCalledOnce();
  });

  it("keeps clarification when several domains are only mentioned as alternatives", async () => {
    const infer = vi.fn().mockResolvedValue(modelDraft({ decision: "clarify", skillId: null,
      candidateIds: ["search-company-policy", "search-expense-policy"], question: "请选择需要查询的事项。",
    }));
    const result = await interpretRequest("我应该查年假制度还是北京差旅标准？", ["knowledge.read"], {}, infer);
    expect(result.intent.choices).toHaveLength(2);
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({ allowParallel: false }));
  });

  it("does not use punctuation to force a parallel plan against the model decision", async () => {
    const result = await interpretRequest("举例：年假规则？北京差旅标准？这些案例是什么？", ["knowledge.read"], {}, vi.fn().mockResolvedValue(modelDraft({
      decision: "clarify", skillId: null, candidateIds: ["search-company-policy", "search-expense-policy"], question: "需要查询哪个事项？",
    })));
    expect(result.route.status).toBe("no_match");
    expect(result.intent.choices).toHaveLength(2);
  });

  it("rejects an unquoted plan rationale and keeps supplied inputs outside parallel planning", async () => {
    const draft = modelDraft({ decision: "parallel", skillId: null, parallelEvidence: "independent tasks",
      tasks: [{ skillId: "search-company-policy", query: "年假制度" }, { skillId: "search-expense-policy", query: "北京差旅标准" }],
    });
    const query = "年假制度？北京差旅标准？";
    expect((await interpretRequest(query, ["knowledge.read"], {}, vi.fn().mockResolvedValue(draft))).route.status).toBe("no_match");
    const infer = vi.fn().mockResolvedValue({ ...draft, parallelEvidence: query });
    expect((await interpretRequest(query, ["knowledge.read"], { parameters: {} }, infer)).route.status).toBe("no_match");
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({ allowParallel: false }));
  });

  it("rejects a plan containing an unauthorized read skill", async () => {
    const result = await interpretRequest("同时查询年假制度和工单状态", ["knowledge.read"], {}, vi.fn().mockResolvedValue(modelDraft({
      decision: "parallel", skillId: null, parallelEvidence: "同时",
      tasks: [{ skillId: "search-company-policy", query: "年假制度" }, { skillId: "get-ticket-status", query: "工单状态" }],
    })));
    expect(result.route.status).toBe("no_match");
  });

  it("extracts a ticket ID only from that task's literal text", async () => {
    const result = await interpretRequest("同时查询年假制度和工单 ESP-20260913-ABCDEF12 的状态", ["knowledge.read", "tickets.read"], {}, vi.fn().mockResolvedValue(modelDraft({
      decision: "parallel", skillId: null, parallelEvidence: "同时",
      tasks: [{ skillId: "search-company-policy", query: "年假制度" }, { skillId: "get-ticket-status", query: "工单 ESP-20260913-ABCDEF12 的状态" }],
    })));
    expect(result.route).toMatchObject({ status: "parallel", tasks: [{ parameters: {} }, { parameters: { ticketId: "ESP-20260913-ABCDEF12" } }] });
  });

  it("does not re-interpret supplied form fields or a selected skill", async () => {
    const infer = vi.fn();
    const parameters = { description: "Laptop fails to start", impact: "individual" as const };
    const result = await interpretRequest("Help with this", ["tickets.create"], { selectedSkillId: "create-it-ticket", parameters }, infer);
    expect(result.intent).toEqual({ source: "selection", parameters });
    expect(result.route).toMatchObject({ status: "matched", requiresConfirmation: true });
    expect(infer).not.toHaveBeenCalled();
  });

  it("rejects a manual selection outside the current permissions", async () => {
    const infer = vi.fn();
    const result = await interpretRequest("Help", ["knowledge.read"], { selectedSkillId: "create-it-ticket" }, infer);
    expect(result.route.status).toBe("no_match");
    expect(infer).not.toHaveBeenCalled();
  });

  it.each(["create ticket", "create ticket: laptop is broken, only my device is affected"])("uses manual input if extraction is unavailable for an already matched write: %s", async (query) => {
    const result = await interpretRequest(query, ["tickets.create"], {}, vi.fn().mockRejectedValue(new Error("Model unavailable")));
    expect(result.route).toMatchObject({ status: "matched", requiresConfirmation: true });
    expect(result.intent).toMatchObject({ parameters: {}, notice: "manual_input" });
  });

  it("does not silently route an ambiguous request during a model outage", async () => {
    await expect(interpretRequest("leave policy and expense policy", ["knowledge.read"], {}, vi.fn().mockRejectedValue(new Error("Model unavailable"))))
      .rejects.toThrow("Model unavailable");
  });

  it("propagates malformed model output and retains literal ticket IDs only", async () => {
    await expect(interpretRequest("What can I do?", ["knowledge.read"], {}, vi.fn().mockResolvedValue({ skillId: "search-company-policy" }))).rejects.toThrow();
    const result = await interpretRequest("ticket status esp-20260910-abcdef12", ["tickets.read"], {}, vi.fn());
    expect(result.intent.parameters.ticketId).toBe("ESP-20260910-ABCDEF12");
  });
});