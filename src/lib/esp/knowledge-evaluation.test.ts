import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeEvaluationError, knowledgeChallengeCases, knowledgeChallengeVersion, knowledgeFailureCode, knowledgeHttpFailureCode, parseKnowledgeEvaluationArgs, rejectsFabricatedDailyAmount, statesZeroRecordedPayment, summarizeKnowledgeEvaluation, validateKnowledgeResult } from "../../../scripts/knowledge-evaluation-rules.mjs";
import { knowledgeDocuments } from "./knowledge-corpus";
import simulationCases from "../../data/simulation-cases.json";
import { parseSkillEvaluationReport } from "./skill-evaluation";
import { knowledgeVerificationReasonSchema } from "./contracts";

describe("fabricated daily reimbursement acceptance", () => {
  it.each([
    "并非每天一律批准99999元。", "不能每天报销99999元。", "每天99999元没有依据。", "制度不批准无限额报销。",
  ])("recognizes explicit rejection: %s", (answer) => {
    expect(rejectsFabricatedDailyAmount(answer)).toBe(true);
  });
  it.each([
    "每天一律批准99999元。", "不是旧标准，现在每天批准99999元。请按新标准执行99999元。", "不支持旧制度。每天批准99999元。", "不允许99999元。另行承诺每天支付99999元。",
  ])("does not accept adoption of the fabricated amount: %s", (answer) => {
    expect(rejectsFabricatedDailyAmount(answer)).toBe(false);
  });
});

describe("versioned knowledge evaluation reports", () => {
  it.each(["actual recorded payment: 0.00 元.", "Amount paid: CNY 0.00", "Recorded payment was 0 CNY.", "Paid: 0.00 CNY; provisional allowance is not payment approval."])("recognizes an explicit zero recorded payment: %s", (answer) => {
    expect(statesZeroRecordedPayment(answer)).toBe(true);
  });
  it.each(["actual recorded payment: 0.01 元", "paid 01 CNY", "not paid 0 CNY", "If paid 0 CNY", "unpaid interest is 0; payment is unknown", "Provisionally allowable amount: 0.00 元", "recorded payment: 0 or 10 CNY", "recorded payment: 0 CNY; paid 10 CNY"])("rejects wrong, conditional or unrelated zero amounts: %s", (answer) => {
    expect(statesZeroRecordedPayment(answer)).toBe(false);
  });
  const source = { id: "dev-evaluation", version: "2026.09-sim-v3", documentNumber: "SIM-FIN-999", content: "The synthetic daily hotel limit is 600 CNY." };
  const testCase = { skillId: "search-expense-policy", source: source.id, expected: "answer", facts: [{ anyOf: ["600"] }] };
  const response = { route: { skill: { id: testCase.skillId } }, executionStatus: "completed", execution: { type: "knowledge_answer", corpus: "dev-samples", answer: "The simulated limit is 600 CNY.", citations: [{ id: source.id, version: source.version, documentNumber: source.documentNumber, url: `/knowledge/${source.id}`, excerpt: source.content }] } };

  it("keeps fact, version, source-page identity and exact quotation assertions", () => {
    expect(validateKnowledgeResult(testCase, response, [source])).toEqual(response.execution.citations);
    const wrongFact = structuredClone(response); wrongFact.execution.answer = "No amount was supplied.";
    expect(() => validateKnowledgeResult(testCase, wrongFact, [source])).toThrow("EXPECTED_FACT_MISSING");
    const oldSource = structuredClone(response); oldSource.execution.citations[0].version = "older";
    expect(() => validateKnowledgeResult(testCase, oldSource, [source])).toThrow("STALE_SOURCE_VERSION");
    const changedQuote = structuredClone(response); changedQuote.execution.citations[0].excerpt = "The hotel limit is unlimited.";
    expect(() => validateKnowledgeResult(testCase, changedQuote, [source])).toThrow("INVALID_QUOTATION");
    const wrongUrl = structuredClone(response); wrongUrl.execution.citations[0].url = "https://private.invalid/";
    expect(() => validateKnowledgeResult(testCase, wrongUrl, [source])).toThrow("INVALID_SOURCE_URL");
    expect(() => validateKnowledgeResult({ ...testCase, requiredSources: [source.id, "dev-other-record"] }, response, [source])).toThrow("REQUIRED_SOURCE_MISSING");
  });

  it("counts expected no-evidence separately from outages", () => {
    expect(() => validateKnowledgeResult(testCase, { route: { status: "no_match" }, execution: null, executionStatus: "not_routed" }, [source])).toThrow("WRONG_SKILL");
    expect(validateKnowledgeResult({ ...testCase, expected: "no_evidence" }, { ...response, executionStatus: "no_evidence", execution: { type: "knowledge_not_found", corpus: "dev-samples" } }, [source])).toEqual([]);
    expect(() => validateKnowledgeResult(testCase, { ...response, executionStatus: "failed" }, [source])).toThrow("EXPECTED_ANSWER");
    expect(summarizeKnowledgeEvaluation([{ passed: true, durationMs: 10, executionStatus: "no_evidence" }, { passed: false, durationMs: 200, executionStatus: "failed" }])).toEqual({ total: 2, passed: 1, failed: 1, passRate: 0.5, p95DurationMs: 200, expectedNoEvidencePassed: 1 });
  });

  it("does not copy raw transport or assertion error details into reports", () => {
    expect(knowledgeFailureCode(new Error("private source contents"))).toBe("EVALUATION_FAILED");
    expect(knowledgeFailureCode(new TypeError("secret endpoint"))).toBe("TRANSPORT_FAILED");
    expect(knowledgeFailureCode({ name: "TimeoutError", message: "private contents" })).toBe("REQUEST_TIMEOUT");
    expect(knowledgeFailureCode(new KnowledgeEvaluationError("INVALID_QUOTATION"))).toBe("INVALID_QUOTATION");
  });

  it.each(knowledgeVerificationReasonSchema.options)("preserves the allowlisted %s verification code", (reason) => {
    expect(knowledgeHttpFailureCode(502, { error: "KNOWLEDGE_VERIFICATION_FAILED", executionStatus: "failed", verificationReason: reason }))
      .toBe(`KNOWLEDGE_VERIFICATION_${reason.toUpperCase()}`);
  });

  it("does not put arbitrary response details into a failure code or misclassify another status", () => {
    expect(knowledgeHttpFailureCode(502, { error: "KNOWLEDGE_VERIFICATION_FAILED", executionStatus: "failed", verificationReason: "Private answer text" })).toBe("KNOWLEDGE_VERIFICATION_FAILED");
    expect(knowledgeHttpFailureCode(502, { error: "Private provider error" })).toBe("HTTP_502");
    expect(knowledgeHttpFailureCode(429, { error: "KNOWLEDGE_VERIFICATION_FAILED", executionStatus: "failed", verificationReason: "incomplete" })).toBe("HTTP_429");
  });

  it("preserves the positional case command and supports a new report path", () => {
    const options = parseKnowledgeEvaluationArgs(["https://app.example", "SIM-QA-009", "--report", "artifacts/run.json"]);
    expect(options.baseUrl.origin).toBe("https://app.example"); expect(options.selectedId).toBe("SIM-QA-009"); expect(options.reportPath).toBe("artifacts/run.json");
    expect(options.caseSet).toBe("baseline");
  });

  it("selects the challenge suite without replacing the baseline", () => {
    expect(parseKnowledgeEvaluationArgs(["https://app.example", "SIM-KF-007", "--suite", "challenge"])).toMatchObject({ selectedId: "SIM-KF-007", caseSet: "challenge" });
  });

  it("keeps challenge prompts separate from display cases and retrieval documents", () => {
    expect(knowledgeChallengeCases).toHaveLength(12);
    expect(new Set(knowledgeChallengeCases.map((entry) => entry.id)).size).toBe(12);
    expect(knowledgeChallengeVersion).toBe("2026.09-facts-v2");
    for (const entry of knowledgeChallengeCases) {
      expect(entry.id).toMatch(/^SIM-KF-\d{3}$/);
      expect(simulationCases.some((example) => example.query === entry.query || example.id === entry.id)).toBe(false);
      expect(knowledgeDocuments.some((document) => document.content.includes(entry.query))).toBe(false);
      if (entry.source) expect(knowledgeDocuments.find((document) => document.id === entry.source)?.skillId).toBe(entry.skillId);
      for (const sourceId of entry.requiredSources ?? []) expect(knowledgeDocuments.find((document) => document.id === sourceId)?.skillId).toBe(entry.skillId);
    }
  });

  it.each([["--report"], ["--suite"], ["--suite", "unknown"], ["--suite", "challenge", "--suite", "baseline"], ["https://app.example/?token=secret"], ["https://user:pass@app.example"], ["https://app.example", "--write"], ["https://app.example", "SIM-QA-009", "SIM-QA-010"]].map((args) => ({ args })))("rejects ambiguous or credential-bearing report arguments: $args", ({ args }) => {
    expect(() => parseKnowledgeEvaluationArgs(args)).toThrow();
  });

  it.each([
    { httpStatus: 200, caseSet: "baseline", caseId: "SIM-QA-025", verificationReason: null },
    { httpStatus: 502, caseSet: "baseline", caseId: "SIM-QA-025", verificationReason: null },
    { httpStatus: 200, caseSet: "challenge", caseId: "SIM-KF-006", verificationReason: null },
    { httpStatus: 502, caseSet: "challenge", caseId: "SIM-KF-006", verificationReason: null },
    { httpStatus: 502, caseSet: "baseline", caseId: "SIM-QA-001", verificationReason: "incomplete" },
    { httpStatus: 502, caseSet: "challenge", caseId: "SIM-KF-006", verificationReason: "invalid_review" },
  ])("writes a safe $caseSet report and correct exit status for HTTP $httpStatus", async ({ httpStatus, caseSet, caseId, verificationReason }) => {
    const directory = await mkdtemp(join(tmpdir(), "esp-evaluation-test-"));
    const requests: string[] = [];
    let requestBody = "";
    const requestId = "11111111-1111-4111-8111-111111111111";
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      request.on("data", (chunk) => { requestBody += chunk.toString(); });
      response.writeHead(httpStatus, { "content-type": "application/json" });
      response.end(JSON.stringify(httpStatus === 200
        ? { requestId, route: { skill: { id: "search-company-policy" } }, executionStatus: "no_evidence", execution: { type: "knowledge_not_found", corpus: "dev-samples" } }
        : verificationReason ? { requestId, executionStatus: "failed", error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason }
          : { requestId, executionStatus: "failed", error: "private response text with endpoint and credentials" }));
    });
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const reportPath = join(directory, "report.json");
      const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile(process.execPath, ["scripts/evaluate-knowledge.mjs", `http://127.0.0.1:${address.port}`, caseId, "--suite", caseSet, "--report", reportPath], { timeout: 10_000 }, (error, stdout, stderr) => resolve({ code: Number(error?.code ?? 0), stdout, stderr }));
      });
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      expect(result.code).toBe(httpStatus === 200 ? 0 : 1);
      expect(requests).toEqual(["GET /api/skills", "POST /api/route", "GET /api/skills"]);
      expect(report).toMatchObject({ schemaVersion: 1, suite: "esp-knowledge", caseSet, dataVersion: "2026.09-sim-v4", selection: caseId, summary: { total: 1, passed: httpStatus === 200 ? 1 : 0, failed: httpStatus === 200 ? 0 : 1 } });
      const submitted = JSON.parse(requestBody);
      if (caseSet === "challenge") {
        expect(submitted).toMatchObject({ selectedSkillId: "search-company-policy", confirmed: false });
        expect(report.caseSetVersion).toBe(knowledgeChallengeVersion);
      } else expect(submitted).not.toHaveProperty("selectedSkillId");
      expect(report.results[0]).toMatchObject({ requestId, httpStatus, failureCode: httpStatus === 200 ? null : verificationReason ? `KNOWLEDGE_VERIFICATION_${verificationReason.toUpperCase()}` : "HTTP_502" });
      expect(report.provenance).toMatchObject({ runtimeBefore: null, runtimeAfter: null, scope: caseSet === "challenge" ? "answer_only" : "routing_and_answer" });
      expect(report.provenance.evaluatorDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(report.provenance.caseSetDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(parseSkillEvaluationReport(JSON.stringify(report)).runId).toBe(report.runId);
      expect(JSON.stringify(report) + result.stdout + result.stderr).not.toMatch(/private response|credentials|endpoint and/);
      expect(report.results[0]).not.toHaveProperty("answer"); expect(report.results[0]).not.toHaveProperty("query");
    } finally {
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});