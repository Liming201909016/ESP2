import { afterEach, describe, expect, it, vi } from "vitest";
import { skillRegistry } from "./registry";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./azure-chat", () => ({ azureChat: () => ({ client: { chat: { completions: { create } } }, deployment: "test-model" }) }));
import { inferIntent, intentDraftSchema } from "./intent-model";

afterEach(() => vi.resetAllMocks());

describe("intent model adapter", () => {
  it("provides only exact eligible synthetic record domain hints without business contents", async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    await inferIntent({ query: "报销单 SIM-EXP-202609-0011 为什么退回，能否付款？", skills: skillRegistry });
    const payload = JSON.parse(create.mock.calls[0][0].messages.find((message: { role: string }) => message.role === "user").content);
    expect(payload.recordHints).toEqual([{ id: "SIM-EXP-202609-0011", skillId: "search-expense-policy" }]);
    for (const options of [{ query: "X-SIM-EXP-202609-0011-more", skills: skillRegistry }, { query: "SIM-EXP-202609-0011", skills: skillRegistry.filter((skill) => skill.id !== "search-expense-policy") }, { query: "SIM-EXP-202609-9999", skills: skillRegistry }]) {
      await inferIntent(options);
      const next = JSON.parse(create.mock.calls.at(-1)![0].messages.find((message: { role: string }) => message.role === "user").content);
      expect(next.recordHints).toEqual([]);
    }
  });
  it("sends only eligible skill definitions and requests a strict response", async () => {
    const draft = {
      decision: "no_match", skillId: null, candidateIds: [], question: null,
      description: null, device: null, impact: null, impactEvidence: null, ticketId: null,
    };
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }] });
    const result = await inferIntent({ query: "something", skills: [skillRegistry[0]] });
    expect(intentDraftSchema.parse(result)).toEqual({ ...draft, parallelEvidence: null, tasks: [], workflowId: null, workflowEvidence: null });
    const request = create.mock.calls[0][0];
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(request.tools).toBeUndefined();
    const payload = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
    expect(payload.eligibleSkills.map((skill: { id: string }) => skill.id)).toEqual([skillRegistry[0].id]);
    expect(payload.parallelReadSkillIds).toEqual([]);
    expect(request.response_format.json_schema.schema.required).toEqual(expect.arrayContaining(["parallelEvidence", "tasks"]));
  });

  it("offers only static read operations for semantic parallel planning without cue words", async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    await inferIntent({ query: "北京住宿多少钱？年假有几天？工单状态如何？", skills: skillRegistry, allowParallel: true });
    const request = create.mock.calls[0][0];
    const payload = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
    expect(payload.parallelReadSkillIds).toHaveLength(6);
    expect(payload.parallelReadSkillIds).not.toContain("create-it-ticket");
    const instructions = request.messages.filter((message: { role: string }) => message.role === "system").map((message: { content: string }) => message.content).join("\n");
    expect(instructions).toContain("are NOT required");
    expect(instructions).toContain("alternative choices");
    expect(instructions).not.toContain("must quote the user's explicit simultaneous");
    await inferIntent({ query: "同时查询制度", skills: skillRegistry, allowParallel: true, fixedSkillId: "search-company-policy" });
    const fixed = create.mock.calls[1][0];
    expect(JSON.parse(fixed.messages.find((message: { role: string }) => message.role === "user").content).parallelReadSkillIds).toEqual([]);
  });
  it("describes cost-center scope and treats multiple fields as one eligible domain task", async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    await inferIntent({ query: "费用成本中心季度预算、已发生、已承诺和剩余是多少？", skills: skillRegistry.filter((skill) => skill.id === "search-expense-policy"), allowParallel: true });
    const request = create.mock.calls[0][0];
    const payload = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
    expect(payload.eligibleSkills).toHaveLength(1);
    expect(payload.eligibleSkills[0].description).toContain("成本中心季度预算");
    expect(request.messages.some((message: { content: string }) => message.content.includes("Several fields of the same record are one task"))).toBe(true);
  });

  it.each(["length", "content_filter"])("rejects incomplete model output: %s", async (finishReason) => {
    create.mockResolvedValue({ choices: [{ finish_reason: finishReason, message: { content: "{}" } }] });
    await expect(inferIntent({ query: "query", skills: [skillRegistry[0]] })).rejects.toThrow("complete result");
  });

  it("offers only the fixed workflow when both read bindings are eligible", async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    await inferIntent({ query: "先查工单再根据结果查 IT 规范", skills: skillRegistry, allowWorkflow: true });
    const request = create.mock.calls[0][0];
    const payload = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
    expect(payload.eligibleWorkflows.map((workflow: { id: string }) => workflow.id)).toEqual(["ticket-handling-guidance"]);
    expect(payload.eligibleWorkflows[0].steps.map((step: { operationId: string }) => step.operationId)).toEqual(["tickets.get", "knowledge.answer"]);
    expect(request.response_format.json_schema.schema.required).toEqual(expect.arrayContaining(["workflowId", "workflowEvidence"]));
    for (const options of [
      { skills: skillRegistry.filter((skill) => skill.id !== "search-software-catalog"), allowWorkflow: true },
      { skills: skillRegistry, allowWorkflow: false },
      { skills: skillRegistry, allowWorkflow: true, fixedSkillId: "get-ticket-status" },
    ]) {
      await inferIntent({ query: "先查工单再根据结果查 IT 规范", ...options });
      const last = create.mock.calls.at(-1)![0];
      expect(JSON.parse(last.messages.find((message: { role: string }) => message.role === "user").content).eligibleWorkflows).toEqual([]);
    }
    expect(request.tools).toBeUndefined();
  });

  it("does not accept an empty or refused result", async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { refusal: "Refused" } }] });
    await expect(inferIntent({ query: "query", skills: [skillRegistry[0]] })).rejects.toThrow("complete result");
  });
});