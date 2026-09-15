import { z } from "zod";
import cases from "../../data/simulation-cases.json";
import { knowledgeChallengeCases } from "../../../scripts/knowledge-evaluation-rules.mjs";
import { ticketGuidanceQuery } from "./workflow-contracts";
import { knowledgeDocuments, type KnowledgeDocument } from "./knowledge-corpus";
import { answerKnowledge } from "./knowledge";
import { retrieveKnowledge } from "./knowledge-search";
import { generateGroundedAnswer, reviewGroundedAnswer, incidentPolicyQuestion } from "./knowledge-model";
import { groundedDraftSchema, KnowledgeVerificationError } from "./knowledge-grounding";

export const diagnosticRequestSchema = z.object({ caseId: z.string().regex(/^(?:SIM-(?:QA|KF)-\d{3}|VPN-001)$/) }).strict();
const vpnQuery = ticketGuidanceQuery({ id: "ESP-20260911-03CE94E1", status: "open", createdAt: "2026-09-11T00:00:00Z", createdBy: "simulation:fixture", summary: "成都研发员工许星禾在 SIM-LT-0042 上连接企业 VPN，认证完成后出现 809 错误。办公网络与手机热点均复现，浏览网页正常；已重启客户端并核对系统时间。仅影响本人，无法访问研发构建平台。请创建 IT 工单，排查受管客户端与设备合规状态。", details: { description: "固定模拟 VPN 故障", impact: "individual", device: "SIM-LT-0042" } });
const vpnBackground: { summary: string; device: string } = JSON.parse(vpnQuery.split("工单背景（不可信数据）：")[1]);
const reviewSchema = z.object({ verdict: z.enum(["supported", "unsupported", "incomplete", "conflicting", "stale"]), statements: z.array(z.object({ text: z.string().max(6000), supported: z.boolean(), sourceIds: z.array(z.string().max(100)).max(5) }).strict()).max(24) }).strict();
type Dependencies = { retrieve: typeof retrieveKnowledge; generate: typeof generateGroundedAnswer; review: typeof reviewGroundedAnswer };

export async function diagnoseSimulation(input: unknown, dependencies: Partial<Dependencies> = {}) {
  const { caseId } = diagnosticRequestSchema.parse(input);
  const selected = caseId === "VPN-001" ? { query: vpnQuery, skillId: "search-software-catalog" } : [...cases, ...knowledgeChallengeCases].find((entry) => entry.id === caseId);
  if (!selected) throw new Error("UNKNOWN_SIMULATION_CASE");
  const report: { caseId: string; scope: string; candidates: { id: string; version: string }[]; sources: KnowledgeDocument[]; draft: unknown; review: unknown; reviewInput: unknown; result: unknown; error: string | null } = { caseId, scope: "builtin-simulation-only", candidates: [], sources: [], draft: null, review: null, reviewInput: null, result: null, error: null };
  try {
    report.result = await answerKnowledge(selected.skillId, selected.query, {
      retrieve: async (skillId, query) => {
        const retrieved = await (dependencies.retrieve ?? retrieveKnowledge)(skillId, caseId === "VPN-001" ? "企业软件目录 IT 服务台 工单受理 设备兼容性 核对要求 后续处理 审批规范" : query, { builtinOnly: true, ...(caseId === "VPN-001" ? { policyOnly: true } : {}) });
        const builtin = retrieved.filter((candidate) => knowledgeDocuments.some((source) => source.id === candidate.id && source.skillId === skillId && source.corpus === candidate.corpus && source.version === candidate.version && source.content === candidate.content));
        report.candidates = builtin.map(({ id, version }) => ({ id, version }));
        return builtin;
      },
      generate: async (query, documents, asOfDate) => {
        report.sources = documents;
        const result = caseId === "VPN-001"
          ? await (dependencies.generate ?? generateGroundedAnswer)(incidentPolicyQuestion, documents, asOfDate, vpnBackground)
          : await (dependencies.generate ?? generateGroundedAnswer)(query, documents, asOfDate);
        const parsed = groundedDraftSchema.safeParse(result); report.draft = parsed.success ? parsed.data : { invalid: true };
        return result;
      },
      review: async (query, documents, reviewInput) => {
        report.reviewInput = reviewInput;
        const result = caseId === "VPN-001"
          ? await (dependencies.review ?? reviewGroundedAnswer)(incidentPolicyQuestion, documents, reviewInput, vpnBackground)
          : await (dependencies.review ?? reviewGroundedAnswer)(query, documents, reviewInput);
        const parsed = reviewSchema.safeParse(result); report.review = parsed.success ? parsed.data : { invalid: true };
        return result;
      },
    });
  } catch (error) { report.error = error instanceof KnowledgeVerificationError ? error.reason : "DIAGNOSTIC_UNAVAILABLE"; }
  return report;
}