import { knowledgeVerificationReasonSchema, type SkillDefinition } from "./contracts";
import {
  evaluationProfileSchema, improvementProposalSchema, skillEvaluationReportSchema,
  type EvaluationProfile, type EvaluationRuntime, type ImprovementTarget, type KnowledgeEvaluationItem, type SkillEvaluationReport,
} from "./skill-evaluation-contracts";

const skillOwners: Record<string, EvaluationProfile["ownerRole"]> = {
  "search-company-policy": "hr",
  "search-expense-policy": "finance",
  "search-procurement-guide": "procurement",
  "search-security-guidance": "security",
  "search-software-catalog": "it",
  "get-ticket-status": "it",
  "create-it-ticket": "it",
};

export function skillEvaluationProfile(skill: SkillDefinition): EvaluationProfile | null {
  const ownerRole = skillOwners[skill.id];
  if (!ownerRole) return null;
  const common = {
    id: `quality-${skill.id}`, version: "1.0.0", skillId: skill.id, skillVersion: skill.version,
    ownerRole, ownerAssignment: "unassigned", minimumCases: 20, thresholdStatus: "provisional", automaticPromotion: false,
  };
  if (skill.category === "knowledge") {
    return evaluationProfileSchema.parse({
      ...common, kind: "knowledge",
      successCriteria: ["correct_entity_facts_units", "applicable_conditions_and_dates", "complete_canonical_citations"],
      abstentionCriteria: ["missing_identity_or_fact", "unresolved_source_conflict", "snapshot_cannot_prove_live_state"],
      hardGates: ["permission_scope", "canonical_evidence", "source_publication", "no_fabricated_effect"],
      metrics: ["answer_correct", "abstention_correct", "false_refusal", "dependency_failure", "latency_p95"],
    });
  }
  if (skill.category === "query") {
    return evaluationProfileSchema.parse({
      ...common, kind: "query",
      successCriteria: ["correct_owner_and_record", "authoritative_status_readback"],
      abstentionCriteria: ["missing_identifier", "absent_or_inaccessible_record"],
      hardGates: ["permission_scope", "owner_scope", "missing_not_outage", "read_only"],
      metrics: ["task_success", "dependency_failure", "latency_p95"],
    });
  }
  return evaluationProfileSchema.parse({
    ...common, kind: "action",
    successCriteria: ["validated_frozen_input", "authorized_single_effect", "verified_business_receipt"],
    abstentionCriteria: ["missing_required_input", "confirmation_or_approval_pending", "unknown_effect_requires_reconciliation"],
    hardGates: ["permission_scope", "confirmation_binding", "approval_required", "idempotent_effect", "receipt_verified", "audit_before_mutation"],
    metrics: ["task_success", "dependency_failure", "latency_p95"],
  });
}

export class SkillEvaluationError extends Error {
  constructor(public code: string) { super(code); this.name = "SkillEvaluationError"; }
}

export const evaluationFileLimit = 1_048_576;

function percentile95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
}

export function parseSkillEvaluationReport(text: string): SkillEvaluationReport {
  if (new TextEncoder().encode(text).byteLength > evaluationFileLimit) throw new SkillEvaluationError("REPORT_TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SkillEvaluationError("INVALID_REPORT"); }
  const parsed = skillEvaluationReportSchema.safeParse(value);
  if (!parsed.success) throw new SkillEvaluationError("INVALID_REPORT");
  const report = parsed.data;
  const results = report.results;
  if (Date.parse(report.completedAt) < Date.parse(report.startedAt) || new Set(results.map((item) => item.caseId)).size !== results.length) {
    throw new SkillEvaluationError("INCONSISTENT_REPORT");
  }
  const expectedPrefix = report.caseSet === "challenge" ? "SIM-KF-" : "SIM-QA-";
  const categories: Record<string, string> = {
    "search-company-policy": "hr", "search-expense-policy": "finance", "search-procurement-guide": "procurement",
    "search-security-guidance": "security", "search-software-catalog": "software",
  };
  for (const item of results) {
    const validOutcome = item.expected === "answer" ? item.executionStatus === "completed"
      : item.expected === "no_evidence" ? item.executionStatus === "no_evidence"
        : ["completed", "no_evidence"].includes(item.executionStatus ?? "");
    if (!item.caseId.startsWith(expectedPrefix) || categories[item.skillId] !== item.category ||
      (report.selection !== "all" && item.caseId !== report.selection) ||
      (item.passed && (item.httpStatus !== 200 || !validOutcome || item.failureCode !== null ||
        (item.executionStatus === "completed" && !item.sources.length) ||
        (item.executionStatus === "no_evidence" && item.sources.length > 0) || item.sources.some((source) => source.version !== report.dataVersion))) ||
      (!item.passed && item.failureCode === null)) {
      throw new SkillEvaluationError("INCONSISTENT_REPORT");
    }
  }
  const passed = results.filter((item) => item.passed).length;
  if (report.summary.total !== results.length || report.summary.passed !== passed || report.summary.failed !== results.length - passed ||
    Math.abs(report.summary.passRate - passed / results.length) > 1e-10 || report.summary.p95DurationMs !== percentile95(results.map((item) => item.durationMs)) ||
    report.summary.expectedNoEvidencePassed !== results.filter((item) => item.passed && item.executionStatus === "no_evidence").length) {
    throw new SkillEvaluationError("INCONSISTENT_REPORT");
  }
  return report;
}

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null };
}

const verificationFailureCodes = new Set(["KNOWLEDGE_VERIFICATION_FAILED", ...knowledgeVerificationReasonSchema.options.map((reason) => `KNOWLEDGE_VERIFICATION_${reason.toUpperCase()}`)]);

function isVerificationFailure(item: KnowledgeEvaluationItem) {
  return !item.passed && item.httpStatus === 502 && verificationFailureCodes.has(item.failureCode ?? "");
}

export function evaluationIssue(item: KnowledgeEvaluationItem): { target: ImprovementTarget; reason: string; confirmed: false } | null {
  if (item.passed) return null;
  const code = item.failureCode;
  if (isVerificationFailure(item)) return { target: "grounding", reason: "verification_not_confirmed", confirmed: false };
  if (item.httpStatus === 429) return { target: "runtime", reason: "model_throttled", confirmed: false };
  if (code === "WRONG_SKILL") return { target: "routing", reason: "route_mismatch", confirmed: false };
  if (["EXPECTED_SOURCE_MISSING", "REQUIRED_SOURCE_MISSING"].includes(code ?? "")) return { target: "retrieval", reason: "source_coverage", confirmed: false };
  if (["STALE_SOURCE_VERSION", "WRONG_DOCUMENT_NUMBER", "UNEXPECTED_CORPUS"].includes(code ?? "")) return { target: "knowledge", reason: "source_version", confirmed: false };
  if (["INVALID_QUOTATION", "INVALID_CITATION_COUNT", "INVALID_SOURCE_URL", "UNKNOWN_SOURCE", "FABRICATED_AMOUNT_ADOPTED", "EXPECTED_FACT_MISSING"].includes(code ?? "")) {
    return { target: "grounding", reason: "answer_evidence", confirmed: false };
  }
  if (code === "EXPECTED_NO_EVIDENCE") return { target: "grounding", reason: "unsupported_answer", confirmed: false };
  if (item.expected === "answer" && item.executionStatus === "no_evidence") return { target: "grounding", reason: "possible_false_refusal", confirmed: false };
  if (code === "REQUEST_TIMEOUT" || code === "TRANSPORT_FAILED") return { target: "runtime", reason: "transport_or_timeout", confirmed: false };
  if ((item.httpStatus ?? 0) >= 500) return { target: "runtime", reason: "dependency_or_validation", confirmed: false };
  return { target: "evaluation", reason: "needs_investigation", confirmed: false };
}

export function summarizeSkillEvaluation(profile: EvaluationProfile, report: SkillEvaluationReport) {
  const cases = report.results.filter((item) => item.skillId === profile.skillId);
  const answerCases = cases.filter((item) => item.expected === "answer");
  const abstentionCases = cases.filter((item) => item.expected === "no_evidence");
  const failures = cases.filter((item) => !item.passed);
  const canonicalFailure = failures.some((item) => ["INVALID_QUOTATION", "INVALID_SOURCE_URL", "UNKNOWN_SOURCE", "WRONG_DOCUMENT_NUMBER", "KNOWLEDGE_VERIFICATION_INVALID_CITATION"].includes(item.failureCode ?? ""));
  return {
    runId: report.runId, sampleSize: cases.length, evidence: cases.length < profile.minimumCases ? "insufficient_samples" : "regression_only",
    pass: ratio(cases.filter((item) => item.passed).length, cases.length),
    answer: ratio(answerCases.filter((item) => item.passed).length, answerCases.length),
    abstention: ratio(abstentionCases.filter((item) => item.passed).length, abstentionCases.length),
    falseRefusal: ratio(answerCases.filter((item) => item.executionStatus === "no_evidence").length, answerCases.length),
    verificationRejected: ratio(cases.filter(isVerificationFailure).length, cases.length),
    executionError: ratio(cases.filter((item) => !isVerificationFailure(item) && (item.httpStatus === 429 || (item.httpStatus ?? 0) >= 500 || ["REQUEST_TIMEOUT", "TRANSPORT_FAILED"].includes(item.failureCode ?? ""))).length, cases.length),
    p95DurationMs: percentile95(cases.map((item) => item.durationMs)),
    gates: profile.hardGates.map((id) => ({ id, status: id === "canonical_evidence" && canonicalFailure ? "failed" as const : "not_evaluated" as const })),
    issues: failures.map((item) => ({ caseId: item.caseId, failureCode: item.failureCode, requestId: item.requestId, ...evaluationIssue(item)! })),
  };
}

function runtimeKey(runtime: EvaluationRuntime | null) {
  return runtime ? JSON.stringify({ ...runtime, skills: [...runtime.skills].sort((left, right) => left.id.localeCompare(right.id)) }) : null;
}

export function compareSkillEvaluations(profile: EvaluationProfile, baseline: SkillEvaluationReport, candidate: SkillEvaluationReport) {
  const before = summarizeSkillEvaluation(profile, baseline);
  const after = summarizeSkillEvaluation(profile, candidate);
  const reasons: string[] = [];
  const baselineCases = baseline.results.filter((item) => item.skillId === profile.skillId);
  const candidateCases = candidate.results.filter((item) => item.skillId === profile.skillId);
  if (!baselineCases.length || !candidateCases.length) reasons.push("skill_not_evaluated");
  if (baseline.runId === candidate.runId) reasons.push("same_run");
  if (profile.kind !== "knowledge") reasons.push("unsupported_report_kind");
  if (baseline.caseSet !== candidate.caseSet || (baseline.caseSetVersion ?? baseline.dataVersion) !== (candidate.caseSetVersion ?? candidate.dataVersion) ||
    baselineCases.length !== candidateCases.length || baselineCases.some((item) => !candidateCases.some((other) => other.caseId === item.caseId && other.expected === item.expected))) {
    reasons.push("case_set_mismatch");
  }
  if (baseline.dataVersion !== candidate.dataVersion) reasons.push("knowledge_changed");
  if (baseline.startedAt.slice(0, 10) !== candidate.startedAt.slice(0, 10)) reasons.push("evaluation_date_changed");
  const oldContext = baseline.provenance;
  const newContext = candidate.provenance;
  if (!oldContext || !newContext) reasons.push("missing_provenance");
  else {
    if (oldContext.evaluatorDigest !== newContext.evaluatorDigest) reasons.push("evaluator_changed");
    if (oldContext.caseSetDigest !== newContext.caseSetDigest || oldContext.scope !== newContext.scope) reasons.push("case_set_mismatch");
    for (const context of [oldContext, newContext]) {
      if (!context.runtimeBefore?.release || !context.runtimeAfter?.release) reasons.push("runtime_untracked");
      if (runtimeKey(context.runtimeBefore) !== runtimeKey(context.runtimeAfter)) reasons.push("runtime_changed_during_run");
      if (!context.runtimeBefore?.skills.some((skill) => skill.id === profile.skillId)) reasons.push("skill_version_missing");
    }
    if (oldContext.runtimeBefore && newContext.runtimeBefore) {
      if (oldContext.runtimeBefore.knowledge.digest !== newContext.runtimeBefore.knowledge.digest ||
        oldContext.runtimeBefore.knowledge.version !== baseline.dataVersion || newContext.runtimeBefore.knowledge.version !== candidate.dataVersion) reasons.push("knowledge_changed");
      if (oldContext.runtimeBefore.configurationDigest !== newContext.runtimeBefore.configurationDigest) reasons.push("configuration_changed");
    }
  }
  const regressions = baselineCases.filter((item) => item.passed && candidateCases.some((other) => other.caseId === item.caseId && !other.passed)).map((item) => item.caseId);
  const improvements = baselineCases.filter((item) => !item.passed && candidateCases.some((other) => other.caseId === item.caseId && other.passed)).map((item) => item.caseId);
  const status = reasons.length ? "not_comparable" as const : regressions.length ? "regression" as const : improvements.length ? "improved" as const : "unchanged" as const;
  const blockers = [
    ...reasons, ...(regressions.length ? ["regression_detected"] : []), ...(candidateCases.some((item) => !item.passed) ? ["candidate_failures"] : []),
    ...(Math.min(before.sampleSize, after.sampleSize) < profile.minimumCases ? ["insufficient_samples"] : []),
    "unverified_import", "hard_gates_unverified", "independent_holdout_missing", "business_review_missing", "owner_unassigned", "model_version_unpinned",
  ];
  return { status, reasons: [...new Set(reasons)], blockers: [...new Set(blockers)], regressions, improvements, baseline: before, candidate: after, automaticPromotion: false as const };
}

export async function evaluationReportDigest(report: SkillEvaluationReport) {
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createImprovementProposal(profile: EvaluationProfile, baseline: SkillEvaluationReport, candidate: SkillEvaluationReport, target: ImprovementTarget, hypothesis: string) {
  if (!baseline.results.some((item) => item.skillId === profile.skillId) || !candidate.results.some((item) => item.skillId === profile.skillId)) {
    throw new SkillEvaluationError("SKILL_NOT_EVALUATED");
  }
  const comparison = compareSkillEvaluations(profile, baseline, candidate);
  const skillIds = Object.keys(skillOwners);
  const affectedSkillIds = ["routing", "runtime", "evaluation"].includes(target) ? skillIds
    : target === "plugin" && profile.kind !== "knowledge" ? ["get-ticket-status", "create-it-ticket"]
      : skillIds.filter((id) => id.startsWith("search-"));
  return improvementProposalSchema.parse({
    schemaVersion: 1, kind: "skill-improvement-proposal", id: globalThis.crypto.randomUUID(), createdAt: new Date().toISOString(),
    skillId: profile.skillId, profileVersion: profile.version, status: "draft", target, hypothesis,
    baseline: { runId: baseline.runId, digest: await evaluationReportDigest(baseline) },
    candidate: { runId: candidate.runId, digest: await evaluationReportDigest(candidate) },
    comparison: comparison.status, regressions: comparison.regressions, improvements: comparison.improvements,
    blockers: comparison.blockers, affectedSkillIds, evidenceTrust: "unverified_import", approval: "not_requested", automaticChanges: false,
  });
}