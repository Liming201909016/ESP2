import { z } from "zod";

export const evaluationGateSchema = z.enum([
  "permission_scope", "canonical_evidence", "source_publication", "no_fabricated_effect",
  "owner_scope", "missing_not_outage", "read_only", "confirmation_binding",
  "approval_required", "idempotent_effect", "receipt_verified", "audit_before_mutation",
]);
export const evaluationMetricSchema = z.enum([
  "answer_correct", "abstention_correct", "false_refusal", "task_success", "dependency_failure", "latency_p95",
]);
export const evaluationProfileSchema = z.object({
  id: z.string().regex(/^quality-[a-z0-9-]+$/),
  version: z.literal("1.0.0"),
  skillId: z.string().regex(/^[a-z0-9-]+$/),
  skillVersion: z.string().min(1).max(80),
  kind: z.enum(["knowledge", "query", "action"]),
  ownerRole: z.enum(["hr", "finance", "procurement", "security", "it"]),
  ownerAssignment: z.literal("unassigned"),
  successCriteria: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
  abstentionCriteria: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
  hardGates: z.array(evaluationGateSchema).min(1),
  metrics: z.array(evaluationMetricSchema).min(1),
  minimumCases: z.literal(20),
  thresholdStatus: z.literal("provisional"),
  automaticPromotion: z.literal(false),
}).strict();

export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;
export type EvaluationGate = z.infer<typeof evaluationGateSchema>;

const identifier = z.string().regex(/^[a-z0-9-]+$/).max(100);
const version = z.string().min(1).max(100);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const evaluationRuntimeSchema = z.object({
  schemaVersion: z.literal(1),
  profileVersion: z.literal("1.0.0"),
  release: z.object({
    releaseId: z.uuid(), buildId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
    sourceCommit: z.union([z.literal("local"), z.string().regex(/^[a-f0-9]{40}$/)]),
  }).strict().nullable(),
  configurationDigest: digest,
  modelIdentity: z.literal("deployment_configuration_only"),
  knowledge: z.object({ version, digest }).strict(),
  skills: z.array(z.object({ id: identifier, version }).strict()).min(1).max(100),
}).strict().refine((value) => new Set(value.skills.map((skill) => skill.id)).size === value.skills.length, "Duplicate skill version");

export const evaluationProvenanceSchema = z.object({
  contractVersion: z.literal("1.0.0"), evaluatorDigest: digest, caseSetDigest: digest,
  scope: z.enum(["routing_and_answer", "answer_only"]),
  runtimeBefore: evaluationRuntimeSchema.nullable(), runtimeAfter: evaluationRuntimeSchema.nullable(),
}).strict();

export const knowledgeEvaluationItemSchema = z.object({
  caseId: z.string().regex(/^SIM-(?:QA|KF)-\d{3}$/),
  category: z.enum(["hr", "finance", "procurement", "security", "software"]),
  skillId: identifier,
  expected: z.enum(["answer", "no_evidence", "correction_or_no_evidence"]),
  passed: z.boolean(), httpStatus: z.number().int().min(100).max(599).nullable(),
  executionStatus: z.enum(["completed", "no_evidence", "failed", "unavailable", "needs_input", "not_routed"]).nullable(),
  requestId: z.uuid().nullable(), durationMs: z.number().int().min(0).max(600_000),
  failureCode: z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable(),
  sources: z.array(z.object({ id: identifier, version }).strict()).max(5),
}).strict();

export const skillEvaluationReportSchema = z.object({
  schemaVersion: z.literal(1), suite: z.literal("esp-knowledge"), runId: z.uuid(),
  targetOrigin: z.string().max(300).refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
    } catch { return false; }
  }, "Invalid target origin"),
  dataVersion: version, caseSet: z.enum(["baseline", "challenge"]).default("baseline"), caseSetVersion: version.optional(),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime(), durationMs: z.number().int().min(0).max(86_400_000),
  selection: z.string().regex(/^(?:all|SIM-(?:QA|KF)-\d{3})$/),
  provenance: evaluationProvenanceSchema.nullable().default(null),
  summary: z.object({
    total: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(1), p95DurationMs: z.number().nonnegative(), expectedNoEvidencePassed: z.number().int().nonnegative(),
  }).strict(),
  results: z.array(knowledgeEvaluationItemSchema).min(1).max(1_000),
}).strict();

export const improvementTargetSchema = z.enum(["routing", "retrieval", "knowledge", "grounding", "plugin", "runtime", "evaluation"]);
export const improvementProposalSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("skill-improvement-proposal"), id: z.uuid(), createdAt: z.iso.datetime(),
  skillId: identifier, profileVersion: z.literal("1.0.0"),
  status: z.literal("draft"), target: improvementTargetSchema,
  hypothesis: z.string().trim().min(10).max(2_000),
  baseline: z.object({ runId: z.uuid(), digest }).strict(), candidate: z.object({ runId: z.uuid(), digest }).strict(),
  comparison: z.enum(["not_comparable", "regression", "improved", "unchanged"]),
  regressions: z.array(z.string().regex(/^SIM-(?:QA|KF)-\d{3}$/)).max(1_000),
  improvements: z.array(z.string().regex(/^SIM-(?:QA|KF)-\d{3}$/)).max(1_000),
  blockers: z.array(z.string().regex(/^[a-z_]+$/)).max(30),
  affectedSkillIds: z.array(identifier).min(1).max(100),
  evidenceTrust: z.literal("unverified_import"), approval: z.literal("not_requested"), automaticChanges: z.literal(false),
}).strict();

export type EvaluationRuntime = z.infer<typeof evaluationRuntimeSchema>;
export type SkillEvaluationReport = z.infer<typeof skillEvaluationReportSchema>;
export type KnowledgeEvaluationItem = z.infer<typeof knowledgeEvaluationItemSchema>;
export type ImprovementTarget = z.infer<typeof improvementTargetSchema>;