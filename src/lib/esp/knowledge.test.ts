import { describe, expect, it, vi } from "vitest";
import { answerKnowledge } from "./knowledge";
import { knowledgeDocuments } from "./knowledge-corpus";
import { assertGroundedNumbers, type GroundedCalculation, type GroundedEvidence } from "./knowledge-grounding";

const source = knowledgeDocuments[0];
const draft = {
  supported: true,
  answer: "Check your leave balance, supply dates and handover details, and request manager approval.",
  citations: [{ id: source.id, quote: source.content.slice(0, source.content.indexOf("。", source.content.indexOf("第3条")) + 1) }],
};
const supportedReview = {
  verdict: "supported",
  statements: [{ text: draft.answer, supported: true, sourceIds: [source.id] }],
};

describe("grounded knowledge answers", () => {
  it("answers the requested leave rule without treating the user's duration as source evidence", async () => {
    const leave = knowledgeDocuments.find((document) => document.id === "dev-hr-leave")!;
    const query = "连续6个工作日年假需提前几天申请？";
    const quote = "超过3个工作日，至少提前7个工作日申请，另需部门负责人审批。申请必须包含起止日期、天数和交接人，批准前不视为已获假。";
    expect(leave.content).toContain(quote);
    const citations = [{ id: leave.id, quote }];
    const review = vi.fn();
    await expect(answerKnowledge(leave.skillId, query, {
      retrieve: vi.fn().mockResolvedValue([leave]),
      generate: vi.fn().mockResolvedValue({ supported: true, answer: "模拟制度：连续6个工作日年假需至少提前7个工作日申请。", citations }), review,
    })).rejects.toThrow(expect.objectContaining({ reason: "unsupported_number" }));
    expect(review).not.toHaveBeenCalled();
    const answer = "模拟制度：连续休假超过3个工作日，至少提前7个工作日申请，另需部门负责人审批。申请须包含起止日期、天数和交接人，批准前不视为已获假。";
    review.mockResolvedValue({ verdict: "supported", statements: [{ text: answer, supported: true, sourceIds: [leave.id] }] });
    await expect(answerKnowledge(leave.skillId, query, {
      retrieve: vi.fn().mockResolvedValue([leave]), generate: vi.fn().mockResolvedValue({ supported: true, answer, citations }), review,
    })).resolves.toMatchObject({ type: "knowledge_answer", answer });
    expect(review).toHaveBeenCalledExactlyOnceWith(query, [leave], expect.objectContaining({ answer }));
  });

  it("returns only validated citations with server-owned source links", async () => {
    const review = vi.fn().mockResolvedValue(supportedReview);
    const result = await answerKnowledge(source.skillId, "How do I request leave?", {
      retrieve: vi.fn().mockResolvedValue([source]), generate: vi.fn().mockResolvedValue(draft),
      review, now: () => new Date("2026-09-12T12:00:00Z"),
    });
    expect(result).toMatchObject({
      type: "knowledge_answer", corpus: "dev-samples", answer: draft.answer,
      citations: [{
        id: source.id, url: `/knowledge/${source.id}`, excerpt: draft.citations[0].quote, version: source.version,
        documentNumber: source.documentNumber, organization: source.organization, owner: source.owner,
        effectiveDate: source.effectiveDate, dataKind: source.dataKind,
      }],
    });
    expect(review).toHaveBeenCalledWith("How do I request leave?", [source], expect.objectContaining({
      answer: draft.answer, calculations: [], asOfDate: "2026-09-12",
      citations: [expect.objectContaining({ id: source.id, excerpt: draft.citations[0].quote })],
    }));
  });

  it("does not call the model without relevant documents", async () => {
    const generate = vi.fn();
    await expect(answerKnowledge(source.skillId, "unrelated", {
      retrieve: vi.fn().mockResolvedValue([]), generate,
    })).resolves.toEqual({ type: "knowledge_not_found", corpus: "dev-samples", reason: "no_search_results" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("discards sources from other scenarios or unpublished content", async () => {
    const generate = vi.fn();
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([knowledgeDocuments[2], { ...source, content: "unpublished content" }]), generate,
    })).resolves.toMatchObject({ type: "knowledge_not_found" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns an honest no-evidence outcome when the source lacks the requested fact", async () => {
    await expect(answerKnowledge(source.skillId, "What is my personal balance?", {
      retrieve: vi.fn().mockResolvedValue([source]),
      generate: vi.fn().mockResolvedValue({ supported: false, answer: "", citations: [] }),
    })).resolves.toMatchObject({ type: "knowledge_not_found", reason: "model_unsupported" });
  });

  it("rejects an invented numeric fact even when its quotation is genuine", async () => {
    expect(source.content).not.toContain("99999");
    const review = vi.fn();
    await expect(answerKnowledge(source.skillId, "What annual leave allowance does the policy provide?", {
      retrieve: vi.fn().mockResolvedValue([source]), review,
      generate: vi.fn().mockResolvedValue({ ...draft, answer: "Every employee receives 99999 days of paid annual leave without approval." }),
    })).rejects.toThrow(expect.objectContaining({ code: "KNOWLEDGE_VERIFICATION_FAILED", reason: "unsupported_number" }));
    expect(review).not.toHaveBeenCalled();
  });

  it("does not authorize a false numeric assertion merely because it occurs in the question", async () => {
    const review = vi.fn();
    await expect(answerKnowledge(source.skillId, "我是不是有99999天年假？", {
      retrieve: vi.fn().mockResolvedValue([source]), review,
      generate: vi.fn().mockResolvedValue({ ...draft, answer: "模拟制度：你有99999天年假。" }),
    })).rejects.toThrow(expect.objectContaining({ reason: "unsupported_number" }));
    expect(review).not.toHaveBeenCalled();
  });

  it("still rejects the wrong applicable branch when the answer omits the user's duration", async () => {
    const leave = knowledgeDocuments.find((document) => document.id === "dev-hr-leave")!;
    const quote = "连续休假不超过3个工作日，至少提前3个工作日申请，由直属经理审批；超过3个工作日，至少提前7个工作日申请，另需部门负责人审批。";
    expect(leave.content).toContain(quote);
    const answer = "模拟制度：该申请至少提前3个工作日提交，仅需直属经理审批。";
    const review = vi.fn().mockResolvedValue({ verdict: "unsupported", statements: [{ text: answer, supported: false, sourceIds: [leave.id] }] });
    await expect(answerKnowledge(leave.skillId, "连续4个工作日年假需提前几天申请？", {
      retrieve: vi.fn().mockResolvedValue([leave]), generate: vi.fn().mockResolvedValue({ supported: true, answer, citations: [{ id: leave.id, quote }] }), review,
    })).rejects.toThrow(expect.objectContaining({ reason: "unsupported" }));
    expect(review).toHaveBeenCalledOnce();
  });

  it.each([
    { ...draft, citations: [] },
    { ...draft, citations: [{ id: "invented-source", quote: draft.citations[0].quote }] },
    { ...draft, citations: [{ id: source.id, quote: "This sentence does not occur in the source." }] },
    { ...draft, answer: "" },
  ])("rejects unsupported answer evidence: %j", async (invalidDraft) => {
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([source]), generate: vi.fn().mockResolvedValue(invalidDraft),
    })).rejects.toThrow(expect.objectContaining({ code: "KNOWLEDGE_VERIFICATION_FAILED", reason: "invalid_citation" }));
  });

  it("rejects malformed generated output with a safe reason and does not request review", async () => {
    const review = vi.fn();
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([source]), generate: vi.fn().mockResolvedValue({ supported: true, answer: { privateText: "Must not escape" } }), review,
    })).rejects.toThrow(expect.objectContaining({ code: "KNOWLEDGE_VERIFICATION_FAILED", reason: "invalid_draft" }));
    expect(review).not.toHaveBeenCalled();
  });

  it("propagates a model outage without generating a fallback answer", async () => {
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([source]), generate: vi.fn().mockRejectedValue(new Error("Model unavailable")),
    })).rejects.toThrow("Model unavailable");
  });

  it("expands a uniquely matching short field using only contiguous original source text", async () => {
    const record = knowledgeDocuments.find((document) => document.id === "dev-sr-202609-0112")!;
    const quote = "影响范围：团队";
    expect(quote.length).toBeLessThan(8);
    const result = await answerKnowledge(record.skillId, "该服务请求的影响范围是什么？", {
      retrieve: vi.fn().mockResolvedValue([record]),
      generate: vi.fn().mockResolvedValue({ supported: true, answer: "模拟记录显示团队受影响。", citations: [{ id: record.id, quote }] }),
      review: vi.fn().mockResolvedValue({ verdict: "supported", statements: [{ text: "模拟记录显示团队受影响。", supported: true, sourceIds: [record.id] }] }),
    });
    if (result.type !== "knowledge_answer") throw new Error("Expected a cited answer");
    const excerpt = result.citations[0].excerpt;
    expect(excerpt.length).toBeGreaterThanOrEqual(8); expect(excerpt.length).toBeLessThanOrEqual(500);
    expect(excerpt).toContain(quote); expect(record.content).toContain(excerpt);
  });

  it("completes a clipped numeric token without changing the original source text", async () => {
    const field = "每年享有10";
    expect(source.content).toContain(field);
    const completeEnd = source.content.indexOf(field) + field.length;
    const quote = source.content.slice(0, completeEnd - 1);
    const result = await answerKnowledge(source.skillId, "leave policy", {
      retrieve: vi.fn().mockResolvedValue([source]),
      generate: vi.fn().mockResolvedValue({ ...draft, citations: [{ id: source.id, quote }] }),
      review: vi.fn().mockResolvedValue(supportedReview),
    });
    if (result.type !== "knowledge_answer") throw new Error("Expected a cited answer");
    expect(result.citations[0].excerpt).toBe(source.content.slice(0, completeEnd));
  });

  it.each(["团队", " ", "虚构字段"])("rejects ambiguous, blank or absent short evidence: %s", async (quote) => {
    const record = knowledgeDocuments.find((document) => document.id === "dev-sr-202609-0112")!;
    await expect(answerKnowledge(record.skillId, "服务请求的影响范围", {
      retrieve: vi.fn().mockResolvedValue([record]),
      generate: vi.fn().mockResolvedValue({ supported: true, answer: "An answer", citations: [{ id: record.id, quote }] }),
    })).rejects.toThrow();
  });

  it.each(["unsupported", "incomplete", "conflicting", "stale"])("does not serve a draft rejected as %s by factual review", async (verdict) => {
    const review = vi.fn().mockResolvedValue({ ...supportedReview, verdict });
    await expect(answerKnowledge(source.skillId, "How do I request leave?", {
      retrieve: vi.fn().mockResolvedValue([source]), generate: vi.fn().mockResolvedValue(draft), review,
    })).rejects.toThrow("failed factual verification");
    expect(review).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "wrong unit", answer: "The simulated leave entitlement is 20 hours." },
    { name: "missing eligibility and approval conditions", answer: "Every simulated employee gets 20 days without approval." },
    { name: "an unsupported personal association", answer: "Your current leave balance is 20 days." },
  ])("requires factual review even for sourced digits with $name", async ({ answer }) => {
    const review = vi.fn().mockResolvedValue({ verdict: "unsupported", statements: [{ text: answer, supported: false, sourceIds: [source.id] }] });
    await expect(answerKnowledge(source.skillId, "What leave entitlement applies?", {
      retrieve: vi.fn().mockResolvedValue([source]), review,
      generate: vi.fn().mockResolvedValue({ ...draft, answer, citations: [{ id: source.id, quote: source.content.slice(0, 500) }] }),
    })).rejects.toThrow("failed factual verification");
    expect(review).toHaveBeenCalledOnce();
  });

  it("does not retry generation or return the draft when the reviewer is unavailable", async () => {
    const generate = vi.fn().mockResolvedValue(draft);
    const review = vi.fn().mockRejectedValue(new Error("Reviewer unavailable"));
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([source]), generate, review,
    })).rejects.toThrow("Reviewer unavailable");
    expect(generate).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
  });

  it("does not send future-effective evidence to generation or review", async () => {
    const generate = vi.fn();
    const review = vi.fn();
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([source]), generate, review, now: () => new Date("2026-08-31T23:59:59Z"),
    })).resolves.toEqual({ type: "knowledge_not_found", corpus: "dev-samples", reason: "no_current_evidence" });
    expect(generate).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it("accepts evidence on its effective UTC date", async () => {
    const generate = vi.fn().mockResolvedValue(draft);
    await expect(answerKnowledge(source.skillId, "leave", {
      retrieve: vi.fn().mockResolvedValue([source]), generate,
      review: vi.fn().mockResolvedValue(supportedReview), now: () => new Date(`${source.effectiveDate}T00:00:00Z`),
    })).resolves.toMatchObject({ type: "knowledge_answer" });
    expect(generate).toHaveBeenCalledWith("leave", [source], source.effectiveDate);
  });
});

describe("deterministic numeric evidence", () => {
  const evidence: GroundedEvidence = {
    id: "dev-expense-record", documentNumber: "SIM-FIN-900", effectiveDate: "2026-09-11", version: "2026.09-sim-v3",
    excerpt: "Simulated claim total: 1970 CNY. Unapproved excess: 240 CNY.",
  };
  const calculation: GroundedCalculation = {
    operation: "subtract", result: "1730",
    operands: ["1970", "240"].map((value) => ({ sourceId: evidence.id, quote: evidence.excerpt, value })),
  };

  it.each(["The simulated total is 1,970.00 CNY.", "模拟总额为１９７０．００元。"])("accepts equivalent sourced decimal formatting: %s", (answer) => {
    expect(() => assertGroundedNumbers(answer, [evidence])).not.toThrow();
  });

  it.each(["99999 CNY", "9.9999e4 CNY", "1730 CNY"])("rejects unsourced values without a verified calculation: %s", (answer) => {
    expect(() => assertGroundedNumbers(answer, [evidence])).toThrow("unsupported numeric fact");
  });

  it("does not conflate large integers through floating-point rounding", () => {
    const large = { ...evidence, excerpt: "Simulated identifier: 9007199254740992." };
    expect(() => assertGroundedNumbers("Identifier: 9007199254740993.", [large])).toThrow("unsupported numeric fact");
  });
  it("recognizes only a complete bracketed canonical title without using its digits as business evidence", () => {
    const source = { ...evidence, title: "Microsoft 365 E3（模拟）", excerpt: "购买容量：120 席。已分配：113 席。可用：7 席。" };
    expect(() => assertGroundedNumbers("《Microsoft 365 E3（模拟）》可用7席。", [source])).not.toThrow();
    for (const answer of ["《Microsoft 365 E3（模拟）》可用365席。", "Microsoft 365 E3可用7席。", "《Microsoft 365 E3》可用7席。", "《Other 365（模拟）》可用7席。"])
      expect(() => assertGroundedNumbers(answer, [source])).toThrow("unsupported numeric fact");
    expect(() => assertGroundedNumbers("《Microsoft 365 E3（模拟）》可用7席。", [{ ...source, title: undefined }])).toThrow("unsupported numeric fact");
    expect(() => assertGroundedNumbers("365 + 7 = 372", [source], [{ operation: "add", result: "372", operands: [{ sourceId: source.id, quote: source.title, value: "365" }, { sourceId: source.id, quote: source.excerpt, value: "7" }] }])).toThrow("unsourced calculation operand");
  });

  it("recomputes a result from operands present in the actual cited excerpt", () => {
    expect(() => assertGroundedNumbers("1970 - 240 = 1730 CNY pending review.", [evidence], [calculation])).not.toThrow();
  });
  it("resolves operands across distinct cited excerpts from the same source regardless of order", () => {
    const first = { ...evidence, excerpt: "Simulated claim total: 1970 CNY." };
    const second = { ...evidence, excerpt: "Unapproved excess: 240 CNY." };
    const split = { ...calculation, operands: [{ sourceId: evidence.id, quote: first.excerpt, value: "1970" }, { sourceId: evidence.id, quote: second.excerpt, value: "240" }] };
    for (const citations of [[first, second], [second, first]]) expect(() => assertGroundedNumbers("1970 - 240 = 1730 CNY", citations, [split])).not.toThrow();
    expect(() => assertGroundedNumbers("1730 CNY", [first], [split])).toThrow("unsourced calculation operand");
  });

  it("adds decimal quantities exactly", () => {
    const decimal = { ...evidence, excerpt: "Simulated base: 0.1 units. Additional quantity: 0.2 units." };
    const addition: GroundedCalculation = {
      operation: "add", result: "0.3",
      operands: ["0.1", "0.2"].map((value) => ({ sourceId: decimal.id, quote: decimal.excerpt, value })),
    };
    expect(() => assertGroundedNumbers("0.1 + 0.2 = 0.3 units.", [decimal], [addition])).not.toThrow();
  });

  it.each(["99999", "-240"])("rejects an invented or sign-swapped operand: %s", (value) => {
    const changed = { ...calculation, operands: [calculation.operands[0], { ...calculation.operands[1], value }] };
    expect(() => assertGroundedNumbers("1730 CNY", [evidence], [changed])).toThrow("unsourced calculation operand");
  });

  it("does not accept an operand from an uncited source or a different excerpt", () => {
    for (const change of [{ sourceId: "another-source" }, { quote: "A fabricated field with 240 CNY." }]) {
      const changed = { ...calculation, operands: [calculation.operands[0], { ...calculation.operands[1], ...change }] };
      expect(() => assertGroundedNumbers("1730 CNY", [evidence], [changed])).toThrow("unsourced calculation operand");
    }
  });

  it("does not accept a clipped operand token from inside a larger source value", () => {
    const changed = {
      ...calculation, result: "1946",
      operands: [calculation.operands[0], { sourceId: evidence.id, quote: "Unapproved excess: 24", value: "24" }],
    };
    expect(() => assertGroundedNumbers("1946 CNY", [evidence], [changed])).toThrow("unsourced calculation operand");
  });

  it("rejects incorrect and unused calculation results", () => {
    expect(() => assertGroundedNumbers("99999 CNY", [evidence], [{ ...calculation, result: "99999" }])).toThrow("calculation result");
    expect(() => assertGroundedNumbers("1970 CNY", [evidence], [calculation])).toThrow("calculation result");
    expect(() => assertGroundedNumbers("99999 CNY", [evidence], [{ ...calculation, result: "99999" }])).toThrow(expect.objectContaining({ code: "KNOWLEDGE_VERIFICATION_FAILED", reason: "invalid_calculation" }));
  });

  it.each(["0", "3"])("rejects division by zero or unproved rounding with divisor %s", (divisor) => {
    const fraction = { ...evidence, excerpt: "Simulated input quantities: 1 unit, 0 units, and 3 units." };
    const division: GroundedCalculation = {
      operation: "divide", result: "0.33",
      operands: ["1", divisor].map((value) => ({ sourceId: fraction.id, quote: fraction.excerpt, value })),
    };
    expect(() => assertGroundedNumbers("0.33 units", [fraction], [division])).toThrow("calculation result");
  });
});