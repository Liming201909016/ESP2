import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { skillRegistry } from "./registry";
import {
  compareSkillEvaluations, createImprovementProposal, evaluationIssue, parseSkillEvaluationReport,
  skillEvaluationProfile, summarizeSkillEvaluation,
} from "./skill-evaluation";
import type { EvaluationRuntime, KnowledgeEvaluationItem, SkillEvaluationReport } from "./skill-evaluation-contracts";
import { getEvaluationRuntime } from "./evaluation-runtime";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { SkillEvaluationPanel } from "../../app/skill-evaluation";
import { knowledgeVerificationReasonSchema } from "./contracts";
import { LocaleProvider } from "../../app/locale-provider";
import type { Locale } from "./locale";
import { evaluationCodeLabel, evaluationErrorKey, evaluationMessages, evaluationText } from "./evaluation-locale";

function renderToStaticMarkup(node: ReactNode, locale: Locale = "zh-CN") {
  return renderMarkup(createElement(LocaleProvider, { initialLocale: locale }, node));
}

afterEach(() => vi.unstubAllEnvs());

const profile = skillEvaluationProfile(skillRegistry[0])!;
const runtime: EvaluationRuntime = {
  schemaVersion: 1, profileVersion: "1.0.0", modelIdentity: "deployment_configuration_only",
  release: { releaseId: "11111111-1111-4111-8111-111111111111", buildId: "build-first", sourceCommit: "local" },
  configurationDigest: "a".repeat(64), knowledge: { version: "2026.09-sim-v3", digest: "b".repeat(64) },
  skills: [{ id: profile.skillId, version: profile.skillVersion }],
};

function item(index: number, passed = true): KnowledgeEvaluationItem {
  return {
    caseId: `SIM-QA-${String(index).padStart(3, "0")}`, category: "hr", skillId: profile.skillId, expected: "answer", passed,
    httpStatus: 200, executionStatus: "completed", requestId: null, durationMs: 100 + index,
    failureCode: passed ? null : "EXPECTED_FACT_MISSING", sources: passed ? [{ id: "dev-hr-leave", version: "2026.09-sim-v3" }] : [],
  };
}

function report(results = [item(1), item(2, false)]): SkillEvaluationReport {
  const passed = results.filter((entry) => entry.passed).length;
  const durations = results.map((entry) => entry.durationMs).sort((left, right) => left - right);
  return {
    schemaVersion: 1, suite: "esp-knowledge", runId: globalThis.crypto.randomUUID(), targetOrigin: "http://127.0.0.1:3100", dataVersion: "2026.09-sim-v3",
    caseSet: "baseline", caseSetVersion: "2026.09-sim-v3", startedAt: "2026-09-12T10:00:00.000Z", completedAt: "2026-09-12T10:01:00.000Z", durationMs: 60_000,
    selection: "all", provenance: {
      contractVersion: "1.0.0", evaluatorDigest: "c".repeat(64), caseSetDigest: "d".repeat(64), scope: "routing_and_answer",
      runtimeBefore: structuredClone(runtime), runtimeAfter: structuredClone(runtime),
    },
    summary: { total: results.length, passed, failed: results.length - passed, passRate: passed / results.length, p95DurationMs: durations[Math.ceil(durations.length * 0.95) - 1], expectedNoEvidencePassed: results.filter((entry) => entry.passed && entry.executionStatus === "no_evidence").length },
    results,
  };
}

describe("skill evaluation evidence", () => {
  it("accepts the existing metadata shape while keeping legacy provenance missing", () => {
    const value = report();
    const { provenance, caseSet, caseSetVersion, ...legacy } = value;
    expect(provenance).not.toBeNull(); expect(caseSet).toBe("baseline"); expect(caseSetVersion).toBeDefined();
    const parsed = parseSkillEvaluationReport(JSON.stringify(legacy));
    expect(parsed.provenance).toBeNull();
    expect(parsed.caseSet).toBe("baseline");
    expect(summarizeSkillEvaluation(profile, parsed).pass).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it("keeps unseen skills and undefined denominators unevaluated", () => {
    const other = skillEvaluationProfile(skillRegistry.find((skill) => skill.id === "create-it-ticket")!)!;
    const summary = summarizeSkillEvaluation(other, report());
    expect(summary.sampleSize).toBe(0); expect(summary.pass.rate).toBeNull(); expect(summary.p95DurationMs).toBeNull();
    expect(summary.gates.every((gate) => gate.status === "not_evaluated")).toBe(true);
  });

  it("separates correct abstention, false refusal and outages", () => {
    const correct = { ...item(1), expected: "no_evidence" as const, executionStatus: "no_evidence" as const, sources: [] };
    const refusal = { ...item(2, false), executionStatus: "no_evidence" as const, failureCode: "EXPECTED_ANSWER" };
    const outage = { ...item(3, false), httpStatus: 502, executionStatus: "failed" as const, failureCode: "HTTP_502" };
    const summary = summarizeSkillEvaluation(profile, parseSkillEvaluationReport(JSON.stringify(report([correct, refusal, outage]))));
    expect(summary.abstention).toMatchObject({ numerator: 1, denominator: 1 });
    expect(summary.falseRefusal).toMatchObject({ numerator: 1, denominator: 2 });
    expect(summary.executionError).toMatchObject({ numerator: 1, denominator: 3 });
    expect(evaluationIssue(outage)).toEqual({ target: "runtime", reason: "dependency_or_validation", confirmed: false });
    expect(summary.issues.every((issue) => issue.confirmed === false)).toBe(true);
  });

  it("does not infer hard-gate coverage from successful business cases", () => {
    expect(summarizeSkillEvaluation(profile, report([item(1)])).gates.every((gate) => gate.status === "not_evaluated")).toBe(true);
    const failure = report([{ ...item(1, false), failureCode: "INVALID_QUOTATION" }]);
    expect(summarizeSkillEvaluation(profile, failure).gates.find((gate) => gate.id === "canonical_evidence")?.status).toBe("failed");
  });

  it("attributes HTTP 429 to throttling without marking factual evidence wrong", () => {
    const throttled = { ...item(1, false), httpStatus: 429, executionStatus: "failed" as const, failureCode: "HTTP_429" };
    const parsed = parseSkillEvaluationReport(JSON.stringify(report([throttled])));
    const summary = summarizeSkillEvaluation(profile, parsed);
    expect(evaluationIssue(throttled)).toEqual({ target: "runtime", reason: "model_throttled", confirmed: false });
    expect(summary.executionError).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(summary.gates.every((gate) => gate.status === "not_evaluated")).toBe(true);
  });

  it.each(knowledgeVerificationReasonSchema.options)("separates %s verification failure from outages and successful refusals", (reason) => {
    const rejected = { ...item(1, false), httpStatus: 502, executionStatus: "failed" as const, failureCode: `KNOWLEDGE_VERIFICATION_${reason.toUpperCase()}` };
    const outage = { ...item(2, false), httpStatus: 502, executionStatus: "failed" as const, failureCode: "HTTP_502" };
    const summary = summarizeSkillEvaluation(profile, parseSkillEvaluationReport(JSON.stringify(report([rejected, outage]))));
    expect(evaluationIssue(rejected)).toEqual({ target: "grounding", reason: "verification_not_confirmed", confirmed: false });
    expect(summary.verificationRejected).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(summary.executionError).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(summary.falseRefusal.numerator).toBe(0);
    expect(summary.pass.numerator).toBe(0);
    expect(summary.gates.find((gate) => gate.id === "canonical_evidence")?.status).toBe(reason === "invalid_citation" ? "failed" : "not_evaluated");
  });

  it.each([
    { name: "summary", mutate: (value: SkillEvaluationReport) => { value.summary.passed = 99; } },
    { name: "duplicate case", mutate: (value: SkillEvaluationReport) => { value.results[1].caseId = value.results[0].caseId; } },
    { name: "false success", mutate: (value: SkillEvaluationReport) => { value.results[1].passed = true; } },
    { name: "missing failure reason", mutate: (value: SkillEvaluationReport) => { value.results[1].failureCode = null; } },
    { name: "wrong skill category", mutate: (value: SkillEvaluationReport) => { value.results[0].skillId = "create-it-ticket"; } },
    { name: "future start", mutate: (value: SkillEvaluationReport) => { value.startedAt = "2026-09-13T00:00:00.000Z"; } },
  ])("rejects inconsistent $name", ({ mutate }) => {
    const value = report(); mutate(value);
    expect(() => parseSkillEvaluationReport(JSON.stringify(value))).toThrow("INCONSISTENT_REPORT");
  });

  it("rejects raw answer fields, credential-bearing origins, malformed and oversized input", () => {
    const value = report();
    expect(() => parseSkillEvaluationReport(JSON.stringify({ ...value, answer: "private contents" }))).toThrow("INVALID_REPORT");
    expect(() => parseSkillEvaluationReport(JSON.stringify({ ...value, targetOrigin: "https://secret:password@example.test" }))).toThrow("INVALID_REPORT");
    expect(() => parseSkillEvaluationReport("not json")).toThrow("INVALID_REPORT");
    expect(() => parseSkillEvaluationReport(" ".repeat(1_048_577))).toThrow("REPORT_TOO_LARGE");
  });

  it("compares the same cases in either order but never promotes automatically", () => {
    const baseline = report(); const candidate = report([item(2), item(1)]);
    const comparison = compareSkillEvaluations(profile, baseline, candidate);
    expect(comparison).toMatchObject({ status: "improved", improvements: ["SIM-QA-002"], regressions: [], automaticPromotion: false });
    expect(comparison.blockers).toEqual(expect.arrayContaining(["insufficient_samples", "unverified_import", "independent_holdout_missing", "business_review_missing"]));
  });

  it("rejects a regression even when aggregate pass rate increases", () => {
    const baseline = report([item(1), item(2, false), item(3, false)]);
    const candidate = report([item(1, false), item(2), item(3)]);
    expect(compareSkillEvaluations(profile, baseline, candidate)).toMatchObject({ status: "regression", regressions: ["SIM-QA-001"], improvements: ["SIM-QA-002", "SIM-QA-003"] });
  });

  it.each([
    { reason: "missing_provenance", mutate: (value: SkillEvaluationReport) => { value.provenance = null; } },
    { reason: "evaluator_changed", mutate: (value: SkillEvaluationReport) => { value.provenance!.evaluatorDigest = "e".repeat(64); } },
    { reason: "case_set_mismatch", mutate: (value: SkillEvaluationReport) => { value.provenance!.caseSetDigest = "e".repeat(64); } },
    { reason: "runtime_untracked", mutate: (value: SkillEvaluationReport) => { value.provenance!.runtimeBefore!.release = null; value.provenance!.runtimeAfter!.release = null; } },
    { reason: "runtime_changed_during_run", mutate: (value: SkillEvaluationReport) => { value.provenance!.runtimeAfter!.release!.buildId = "different"; } },
    { reason: "knowledge_changed", mutate: (value: SkillEvaluationReport) => { value.dataVersion = "other-data"; } },
    { reason: "configuration_changed", mutate: (value: SkillEvaluationReport) => { value.provenance!.runtimeBefore!.configurationDigest = "e".repeat(64); value.provenance!.runtimeAfter!.configurationDigest = "e".repeat(64); } },
    { reason: "skill_version_missing", mutate: (value: SkillEvaluationReport) => { value.provenance!.runtimeBefore!.skills[0].id = "other-skill"; } },
  ])("does not compare reports with $reason", ({ reason, mutate }) => {
    const baseline = report(); const candidate = report(); mutate(candidate);
    expect(compareSkillEvaluations(profile, baseline, candidate)).toMatchObject({ status: "not_comparable", reasons: expect.arrayContaining([reason]) });
  });

  it("exports a draft proposal with evidence hashes and shared-knowledge blast radius", async () => {
    const baseline = report(); const candidate = report([item(1), item(2)]);
    const proposal = await createImprovementProposal(profile, baseline, candidate, "grounding", "Check entity and unit bindings before returning each knowledge assertion.");
    expect(proposal).toMatchObject({ status: "draft", comparison: "improved", evidenceTrust: "unverified_import", approval: "not_requested", automaticChanges: false });
    expect(proposal.baseline.digest).toMatch(/^[a-f0-9]{64}$/); expect(proposal.affectedSkillIds).toHaveLength(5);
    expect(JSON.stringify(proposal)).not.toContain("targetOrigin");
    await expect(createImprovementProposal(profile, baseline, candidate, "grounding", "")).rejects.toThrow();
  });

  it.each(["routing", "runtime", "evaluation"] as const)("includes every registered skill for shared %s changes", async (target) => {
    const proposal = await createImprovementProposal(profile, report(), report([item(1), item(2)]), target, "Review this shared implementation change across every affected skill.");
    expect(proposal.affectedSkillIds).toEqual(skillRegistry.map((skill) => skill.id));
  });

  it("includes all five knowledge skills for a shared Knowledge plugin change", async () => {
    const proposal = await createImprovementProposal(profile, report(), report([item(1), item(2)]), "plugin", "Validate the shared Knowledge plugin response contract for all bindings.");
    expect(proposal.affectedSkillIds).toEqual(skillRegistry.filter((skill) => skill.category === "knowledge").map((skill) => skill.id));
  });

  it("keeps challenge samples outside runtime source modules", async () => {
    const source = await readFile(new URL("./skill-evaluation.ts", import.meta.url), "utf8");
    expect(source).not.toContain("knowledge-evaluation-rules");
  });
});

describe("evaluation runtime capture", () => {
  it("does not infer a release from a development build or expose other skills", async () => {
    const read = vi.fn();
    const captured = await getEvaluationRuntime(["tickets.read"], { production: false, read });
    expect(captured?.release).toBeNull();
    expect(captured?.skills).toEqual([{ id: "get-ticket-status", version: "0.1.0" }]);
    expect(read).not.toHaveBeenCalled();
    expect(await getEvaluationRuntime([], { production: true, read })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("binds a packaged release marker to its actual build ID", async () => {
    const marker = {
      schemaVersion: 1, application: "esp-platform", releaseId: runtime.release!.releaseId, createdAt: "2026-09-12T00:00:00.000Z",
      sourceCommit: "local", buildRunId: null, buildId: "build-first", applicationVersion: "0.1.0", nodeMajor: 24,
      stateBackend: "postgres", stateSchemaVersion: 1, knowledgeVersion: "2026.09-sim-v4", knowledgeDigest: "b".repeat(64),
    };
    const read = vi.fn(async (path: string) => path.endsWith("esp-release.json") ? JSON.stringify(marker) : "build-first");
    expect((await getEvaluationRuntime(["knowledge.read"], { production: true, read }))?.release).toEqual(runtime.release);
    const wrongBuild = vi.fn(async (path: string) => path.endsWith("esp-release.json") ? JSON.stringify(marker) : "another-build");
    expect((await getEvaluationRuntime(["knowledge.read"], { production: true, read: wrongBuild }))?.release).toBeNull();
  });

  it("returns configuration digests, not endpoints, deployment values or credentials", async () => {
    vi.stubEnv("AZURE_AI_ENDPOINT", "https://private-model.example.test");
    vi.stubEnv("AZURE_AI_CHAT_DEPLOYMENT", "private-model-name");
    vi.stubEnv("POSTGRES_PASSWORD", "not-for-export");
    const captured = await getEvaluationRuntime(["knowledge.read"], { production: false });
    expect(captured?.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(captured)).not.toMatch(/private-model|not-for-export/);
    vi.stubEnv("AZURE_AI_CHAT_DEPLOYMENT", "changed-model-name");
    expect((await getEvaluationRuntime(["knowledge.read"], { production: false }))?.configurationDigest).not.toBe(captured?.configurationDigest);
  });
});

describe("skill evaluation view", () => {
  it("has complete bilingual labels for all registered criteria without treating unknown codes as success", () => {
    for (const pair of Object.values(evaluationMessages)) {
      expect(pair).toHaveLength(2);
      expect(pair.every((value) => value.trim().length > 0)).toBe(true);
      expect(pair[0]).not.toMatch(/[\u4e00-\u9fff]/);
    }
    for (const skill of skillRegistry) {
      const contract = skillEvaluationProfile(skill)!;
      for (const code of [...contract.successCriteria, ...contract.abstentionCriteria, ...contract.hardGates, contract.ownerRole]) expect(evaluationCodeLabel("en-US", code)).not.toBe(code);
    }
    for (const code of ["unknown_gate", "__proto__", "toString"]) expect(evaluationCodeLabel("en-US", code)).toBe(code);
    for (const code of ["private error", "__proto__", null]) expect(evaluationErrorKey(code, "importFailed")).toBe("importFailed");
    for (const code of ["REPORT_TOO_LARGE", "INVALID_REPORT", "INCONSISTENT_REPORT", "SKILL_NOT_EVALUATED"]) expect(evaluationErrorKey(code, "exportFailed")).toBe(code);
  });
  it.each(["en-US", "zh-CN"] as const)("retains report and comparison evidence while rendering %s", (locale) => {
    const baseline = report(); const candidate = report([item(1), item(2)]);
    const before = JSON.stringify({ baseline, candidate, profile });
    const comparison = compareSkillEvaluations(profile, baseline, candidate);
    const markup = renderToStaticMarkup(createElement(SkillEvaluationPanel, { profile, reports: { baseline: { filename: "baseline.json", report: baseline }, candidate: { filename: "candidate.json", report: candidate } }, onReport: vi.fn() }), locale);
    expect(markup).toContain(evaluationText(locale, "improved"));
    expect(markup).toContain("1 / 2 (50.0%)");
    expect(markup).toContain("2 / 2 (100.0%)");
    expect(markup).toContain(evaluationText(locale, "notEvaluated"));
    expect(markup).toContain(evaluationText(locale, "insufficient_samples"));
    expect(markup).toContain(evaluationText(locale, "business_review_missing"));
    expect(markup).toContain(evaluationText(locale, "draft"));
    expect(markup).toContain(evaluationText(locale, "off"));
    expect(markup).toMatch(/datetime="2026-09-12T10:01:00\.000Z"/i);
    expect(markup).toContain('value="grounding" selected=""');
    expect(JSON.stringify({ baseline, candidate, profile })).toBe(before);
    expect(compareSkillEvaluations(profile, baseline, candidate)).toEqual(comparison);
  });
  it("keeps English not-comparable warnings and ticket collector limitations explicit", () => {
    const baseline = report(); const candidate = report(); candidate.provenance = null;
    const markup = renderToStaticMarkup(createElement(SkillEvaluationPanel, { profile, reports: { baseline: { filename: "baseline.json", report: baseline }, candidate: { filename: "candidate.json", report: candidate } }, onReport: vi.fn() }), "en-US");
    expect(markup).toContain("Not comparable");
    expect(markup).toContain("Evaluation provenance missing");
    const ticket = skillEvaluationProfile(skillRegistry.find((skill) => skill.id === "create-it-ticket")!)!;
    const ticketHtml = renderToStaticMarkup(createElement(SkillEvaluationPanel, { profile: ticket, reports: { baseline: null, candidate: null }, onReport: vi.fn() }), "en-US");
    expect(ticketHtml).toContain("Ticket evaluation collector not connected");
    expect(ticketHtml).toContain("No evaluation evidence");
    expect(ticketHtml).toMatch(/type="submit" disabled=""/);
    expect(ticketHtml).not.toContain("100.0%");
  });
  it("renders an unevaluated contract without a score or enabled proposal action", () => {
    const markup = renderToStaticMarkup(createElement(SkillEvaluationPanel, {
      profile, reports: { baseline: null, candidate: null }, onReport: vi.fn(),
    }));
    expect(markup).toContain("尚无评价证据");
    expect(markup).toContain("未上传服务器");
    expect(markup).toContain("文件来源未核验");
    expect(markup).toMatch(/type="submit" disabled=""/);
    expect(markup).not.toContain("100.0%");
  });

  it("renders paired metrics and blockers for an improved candidate without approval", () => {
    const markup = renderToStaticMarkup(createElement(SkillEvaluationPanel, {
      profile, onReport: vi.fn(),
      reports: { baseline: { filename: "baseline.json", report: report() }, candidate: { filename: "candidate.json", report: report([item(1), item(2)]) } },
    }));
    expect(markup).toContain("断言通过数改善");
    expect(markup).toContain("1 / 2 (50.0%)");
    expect(markup).toContain("2 / 2 (100.0%)");
    expect(markup).toContain("业务审核未完成");
    expect(markup).toContain("草稿 · 未申请审批");
  });

  it("keeps ticket contracts visible without claiming knowledge measurements for them", () => {
    const ticket = skillEvaluationProfile(skillRegistry.find((skill) => skill.id === "create-it-ticket")!)!;
    const markup = renderToStaticMarkup(createElement(SkillEvaluationPanel, {
      profile: ticket, reports: { baseline: null, candidate: null }, onReport: vi.fn(),
    }));
    expect(markup).toContain("工单评价采集器尚未接入");
    expect(markup).toContain("重复执行不重复办理");
    expect(markup).not.toContain("当前技能分项评价");
  });
});