import { z } from "zod";
import type { KnowledgeBase } from "./contracts";
import enterprisePack from "../../data/enterprise-pack.json";

export const knowledgeSkillIds = [
  "search-company-policy",
  "search-expense-policy",
  "search-procurement-guide",
  "search-security-guidance",
  "search-software-catalog",
] as const;

export const knowledgeDocumentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  skillId: z.enum(knowledgeSkillIds),
  corpus: z.enum(["esp-dev-samples-v1", "esp-dev-managed-v1"]),
  permission: z.literal("knowledge.read"),
  version: z.string().min(1),
  organization: z.literal("澄川数科（虚构组织）"),
  documentNumber: z.string().regex(/^SIM-[A-Z0-9-]{3,60}$/),
  owner: z.string().min(1),
  effectiveDate: z.iso.date(),
  dataKind: z.enum(["policy", "snapshot"]),
  title: z.string().min(1),
  section: z.string().min(1),
  content: z.string().min(1).max(4_000),
  searchTerms: z.string().min(1),
});

export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
export const knowledgeDocuments = z.array(knowledgeDocumentSchema.extend({
  corpus: z.literal("esp-dev-samples-v1"),
  documentNumber: z.string().regex(/^SIM-(HR|FIN|PUR|SEC|IT)-\d{3}$/),
})).parse(enterprisePack.documents);
export const knowledgeCorpus = "esp-dev-samples-v1";
export const managedKnowledgeCorpus = "esp-dev-managed-v1";
export const knowledgeDataVersion = enterprisePack.version;
export const knowledgeIndexName = "esp-knowledge-dev-v1";
export const financeKnowledgeIndexName = "esp-finance-dev-v1";

export function knowledgeIndexForSkill(skillId: string) {
  return process.env.ESP_FINANCE_KNOWLEDGE_ENABLED === "true" && skillId === "search-expense-policy"
    ? financeKnowledgeIndexName : knowledgeIndexName;
}

export function knowledgeBaseForSkill(skillId: string): KnowledgeBase {
  return knowledgeIndexForSkill(skillId) === financeKnowledgeIndexName
    ? { id: "finance", name: "财务差旅知识库", indexName: financeKnowledgeIndexName }
    : { id: "enterprise", name: "企业制度知识库", indexName: knowledgeIndexName };
}