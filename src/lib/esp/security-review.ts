import { z } from "zod";

export const securityReviewVersion = "1.0.0";
export const reviewCaseSchema = z.enum(["complete", "missing", "high-risk", "conflicting"]);
export const reviewStatusSchema = z.enum(["awaiting_decision", "needs_information", "approved", "rejected"]);
export const reviewIdSchema = z.string().regex(/^sr-[a-f0-9]{32}$/);
const evidenceSchema = z.object({ id: z.string(), field: z.enum(["license", "data", "source"]), value: z.enum(["verified", "unverified", "restricted", "external", "approved", "unapproved"]), excerpt: z.string().min(8).max(500), documentNumber: z.string(), version: z.literal("1.0.0") }).strict();
const findingSchema = z.object({ controlId: z.string(), title: z.string(), status: z.enum(["pass", "missing", "fail", "conflict"]), severity: z.enum(["none", "medium", "high"]), evidenceIds: z.array(z.string()), requirement: z.string(), recommendation: z.string() }).strict();
const eventSchema = z.object({ action: z.enum(["submitted", "needs_information", "approved", "rejected"]), actor: z.string().min(1), at: z.iso.datetime(), reason: z.string().max(1000), requestId: z.uuid() }).strict();
export const securityReviewSchema = z.object({
  schemaVersion: z.literal(1), id: reviewIdSchema, createdBy: z.string().min(1), submissionId: z.uuid(), createdAt: z.iso.datetime(),
  caseId: reviewCaseSchema, query: z.string().min(1).max(2000), objectId: z.literal("SIM-SW-202609-0031"), objectName: z.literal("Docker Desktop 引入审查（模拟）"),
  policyVersion: z.literal("1.0.0"), status: reviewStatusSchema, evidence: z.array(evidenceSchema), findings: z.array(findingSchema),
  previousReviewId: reviewIdSchema.nullable().default(null),
  evaluation: z.object({ evidenceComplete: z.boolean(), noConflicts: z.boolean(), controlsPassed: z.boolean(), humanDecisionRequired: z.literal(true) }).strict(),
  stages: z.array(z.object({ skillId: z.string(), version: z.literal("1.0.0"), operationId: z.string(), status: z.literal("completed") }).strict()),
  history: z.array(eventSchema).min(1).max(2),
}).strict();
export type SecurityReview = z.infer<typeof securityReviewSchema>;
export const storedSecurityReviewSchema = z.object({ record: securityReviewSchema, etag: z.string().min(1) }).strict();
export type StoredSecurityReview = z.infer<typeof storedSecurityReviewSchema>;

export const reviewCapabilities = [
  { id: "security-review-intake", name: "审查受理", operationId: "review-records.create", version: securityReviewVersion },
  { id: "security-evidence-extraction", name: "证据提取", operationId: "review-evidence.read", version: securityReviewVersion },
  { id: "security-control-check", name: "控制要求核对", operationId: "review-controls.check", version: securityReviewVersion },
  { id: "security-risk-analysis", name: "风险与整改分析", operationId: "review-controls.assess", version: securityReviewVersion },
  { id: "security-report-generation", name: "审查报告生成", operationId: "review-reports.render", version: securityReviewVersion },
] as const;
export const reviewPlugins = [
  { id: "review-evidence", name: "模拟证据读取", operations: ["review-evidence.read"] },
  { id: "review-controls", name: "控制检查", operations: ["review-controls.check", "review-controls.assess"] },
  { id: "review-records", name: "审查记录", operations: ["review-records.create", "review-records.decide"] },
  { id: "review-reports", name: "审查报告", operations: ["review-reports.render"] },
] as const;
export const reviewCases = [
  { id: "complete", name: "材料完整", description: "模拟许可、数据范围和分发来源均满足检查要求" },
  { id: "missing", name: "材料缺失", description: "缺少数据处理范围证据" },
  { id: "high-risk", name: "高风险", description: "模拟材料明确包含未批准的数据外发" },
  { id: "conflicting", name: "证据冲突", description: "两份许可核验材料结论不一致" },
] as const;
export const reviewControls = [
  { id: "SIM-CTRL-LICENSE", field: "license", title: "商业许可核验", expected: "verified", requirement: "模拟检查要求：本次用途的商业许可核验结果必须明确为已核验。", recommendation: "补齐本次使用范围的许可核验材料。" },
  { id: "SIM-CTRL-DATA", field: "data", title: "数据处理范围", expected: "restricted", requirement: "模拟检查要求：数据范围限定为合成数据，禁止未批准外发。", recommendation: "提供数据范围与外发控制证据，解除未批准外发风险。" },
  { id: "SIM-CTRL-SOURCE", field: "source", title: "安装与镜像来源", expected: "approved", requirement: "模拟检查要求：安装和镜像来源必须经过本次模拟审查的来源核验。", recommendation: "提供经核验的分发与镜像来源。" },
] as const;

export function readReviewEvidence(caseId: z.infer<typeof reviewCaseSchema>) {
  reviewCaseSchema.parse(caseId);
  const evidence: z.infer<typeof evidenceSchema>[] = [
    { id: "SIM-EVID-LICENSE", field: "license", value: "verified", excerpt: "【模拟材料】本次研发试用范围的商业许可核验结果：已核验。仅为功能演示，不代表真实厂商授权。", documentNumber: "SIM-SR-LICENSE", version: "1.0.0" },
    { id: "SIM-EVID-DATA", field: "data", value: caseId === "high-risk" ? "external" : "restricted", excerpt: caseId === "high-risk" ? "【模拟材料】本次试用计划向未经批准的外部服务发送数据；数据外发控制尚未落实。" : "【模拟材料】本次试用仅处理合成数据，数据外发已限制在经核验的演示范围内。", documentNumber: "SIM-SR-DATA", version: "1.0.0" },
    { id: "SIM-EVID-SOURCE", field: "source", value: "approved", excerpt: "【模拟材料】本次安装包和镜像来源已通过演示来源核验；不会执行真实下载或安装。", documentNumber: "SIM-SR-SOURCE", version: "1.0.0" },
  ];
  if (caseId === "missing") return evidence.filter((entry) => entry.field !== "data");
  if (caseId === "conflicting") evidence.push({ id: "SIM-EVID-LICENSE-CONFLICT", field: "license", value: "unverified", excerpt: "【模拟补充材料】本次用途商业许可尚未核验，与原核验材料存在冲突；不得假定新材料自动覆盖旧材料。", documentNumber: "SIM-SR-LICENSE-ALT", version: "1.0.0" });
  return evidence;
}
export function checkReviewControls(evidence: z.infer<typeof evidenceSchema>[]) {
  return reviewControls.map((control): z.infer<typeof findingSchema> => {
    const matching = evidence.filter((entry) => entry.field === control.field);
    const status = !matching.length ? "missing" : new Set(matching.map((entry) => entry.value)).size > 1 ? "conflict" : matching[0].value === control.expected ? "pass" : "fail";
    return { controlId: control.id, title: control.title, status, severity: status === "pass" ? "none" : status === "missing" ? "medium" : "high", evidenceIds: matching.map((entry) => entry.id), requirement: control.requirement, recommendation: status === "pass" ? "保留本次证据与版本，等待人工决定。" : control.recommendation };
  });
}
export function assessReview(findings: SecurityReview["findings"]): SecurityReview["evaluation"] {
  return { evidenceComplete: findings.every((finding) => finding.status !== "missing"), noConflicts: findings.every((finding) => finding.status !== "conflict"), controlsPassed: findings.every((finding) => finding.status === "pass"), humanDecisionRequired: true };
}
export function createSecurityReview(input: { id: string; submissionId: string; caseId: z.infer<typeof reviewCaseSchema>; query: string; previousReviewId?: string | null }, owner: string, requestId: string, now = new Date()) {
  const evidence = readReviewEvidence(input.caseId);
  const findings = checkReviewControls(evidence);
  return securityReviewSchema.parse({ schemaVersion: 1, ...input, createdBy: owner, createdAt: now.toISOString(), objectId: "SIM-SW-202609-0031", objectName: "Docker Desktop 引入审查（模拟）", policyVersion: securityReviewVersion, status: "awaiting_decision", evidence, findings, evaluation: assessReview(findings), stages: reviewCapabilities.slice(0, 4).map((skill) => ({ skillId: skill.id, version: skill.version, operationId: skill.operationId, status: "completed" })), history: [{ action: "submitted", actor: owner, at: now.toISOString(), reason: "固定模拟材料包；未执行安装、授权或数据外发。", requestId }] });
}
export class SecurityReviewError extends Error {
  constructor(public code: "REVIEW_NOT_FOUND" | "REVIEW_CONFLICT" | "REVIEW_BLOCKED" | "REVIEW_FINALIZED" | "REVIEW_SCOPE_UNSUPPORTED", public status: number) { super(code); }
}
const reviewObjectPattern = "(?:Docker Desktop|SIM-SW-202609-0031)";
const englishReviewPrefix = "(?:(?:please|(?:can|could|would) you(?: please)?|I (?:would like|want|need)(?: to)?) )?";
const englishReviewPatterns = [
  `(?:(?:run|perform|conduct|start|request) )?(?:(?:a|the) )?security (?:review|assessment) (?:of|for) (?:adopting |introducing )?${reviewObjectPattern}(?: (?:adoption|introduction))?`,
  `(?:review|assess) (?:the )?security of ${reviewObjectPattern}`,
  `(?:review|assess) ${reviewObjectPattern} (?:for security|security)`,
].map((pattern) => new RegExp(`^${englishReviewPrefix}${pattern}[.!?]?$`, "i"));
const chineseReviewPatterns = [
  `(?:请(?:帮我)?|帮我)?(?:对)? ?${reviewObjectPattern} ?(?:的)?(?:引入|采用|使用)? ?(?:进行|开展)? ?安全(?:审查|评审)`,
  `(?:请(?:帮我)?|帮我)?(?:进行|开展)? ?安全(?:审查|评审) ?${reviewObjectPattern}`,
  `(?:请(?:帮我)?|帮我)?(?:审查|评审) ?${reviewObjectPattern} ?的安全性`,
].map((pattern) => new RegExp(`^${pattern}[。！？.!?]?$`, "i"));
export function discoverSecurityReview(query: string) {
  if (query.length > 2000) return null;
  const normalized = query.trim().replace(/\s+/g, " ");
  return [...englishReviewPatterns, ...chineseReviewPatterns].some((pattern) => pattern.test(normalized))
    ? { workflowId: "software-security-review", version: securityReviewVersion, objectId: "SIM-SW-202609-0031", capabilities: reviewCapabilities, plugins: reviewPlugins }
    : null;
}
export function decideSecurityReview(record: SecurityReview, action: "approve" | "reject" | "request_information", reason: string, actor: string, requestId: string, now = new Date()) {
  if (record.status !== "awaiting_decision") throw new SecurityReviewError("REVIEW_FINALIZED", 409);
  if (action === "approve" && !record.evaluation.controlsPassed) throw new SecurityReviewError("REVIEW_BLOCKED", 409);
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs_information";
  return securityReviewSchema.parse({ ...record, status, history: [...record.history, { action: status, actor, at: now.toISOString(), reason: z.string().trim().min(3).max(1000).parse(reason), requestId }] });
}
export function renderSecurityReport(record: SecurityReview) {
  const parsed = securityReviewSchema.parse(record);
  return { schemaVersion: 1, kind: "esp-security-review", simulated: true, review: parsed, reportSkill: reviewCapabilities[4], warning: "仅为固定模拟材料审查，不是厂商认证或真实上线许可；DEV 申请人与审查人使用共享身份。" };
}