import { z } from "zod";
import { skillParametersSchema, skillQuerySchema, ticketDetailsSchema, type ExecutionResult, type Permission, type SkillDefinition } from "./contracts";
import type { CatalogEntry } from "./catalog-contracts";
import { knowledgeBaseForSkill, knowledgeDocuments } from "./knowledge-corpus";
import { skillRegistry } from "./registry";
import { skillExecutionKind, type SkillExecutionKind } from "./skill-execution";
import { simulationCases } from "./simulation-cases";
import { stateBackend } from "./state-config";
import { enterpriseData } from "./enterprise-data";
import { skillEvaluationProfile } from "./skill-evaluation";

const inputLabels: Record<string, string> = {
  query: "业务问题",
  description: "问题描述",
  device: "设备 / 应用",
  impact: "影响范围",
  ticketId: "工单编号",
};

const inputSchemas = {
  knowledge: z.object({ query: skillQuerySchema }).strict(),
  ticket_lookup: skillParametersSchema.pick({ ticketId: true }).required(),
  ticket_create: ticketDetailsSchema,
  unavailable: z.object({}).strict(),
};

const resultTypes: Record<SkillExecutionKind, ExecutionResult["type"][]> = {
  knowledge: ["knowledge_answer", "knowledge_not_found"],
  ticket_lookup: ["ticket_status", "input_required", "ticket_not_found"],
  ticket_create: ["ticket_details_required", "ticket_created"],
  unavailable: ["unavailable"],
};

const ticketExamples: Record<string, CatalogEntry["examples"]> = {
  "get-ticket-status": [
    { id: "ticket-lookup-input", title: "按编号查询工单", query: "查询工单状态" },
  ],
  "create-it-ticket": [
    ...enterpriseData.serviceRequests.map((request) => ({ id: request.id, title: request.title, query: request.description })),
    { id: "ticket-create-input", title: "缺少必填信息", query: "创建工单" },
  ],
};

export function catalogDefinitions(
  permissions: Permission[],
  registry: SkillDefinition[] = skillRegistry,
): SkillDefinition[] {
  return registry.filter((skill) => skill.permissions.every((permission) => permissions.includes(permission)));
}

export function getSkillCatalog(permissions: Permission[], registry: SkillDefinition[] = skillRegistry): CatalogEntry[] {
  return catalogDefinitions(permissions, registry).map((skill) => {
    const implementation = skillExecutionKind(skill.id);
    const inputSchema = z.toJSONSchema(inputSchemas[implementation]);
    const inputs = Object.entries(inputSchema.properties ?? {}).map(([name, property]) => {
      const rule = typeof property === "object" && property !== null ? property : {};
      return {
        name,
        label: inputLabels[name] ?? name,
        required: inputSchema.required?.includes(name) ?? false,
        options: Array.isArray(rule.enum) ? rule.enum.filter((value): value is string => typeof value === "string") : [],
        minLength: typeof rule.minLength === "number" ? rule.minLength : null,
        maxLength: typeof rule.maxLength === "number" ? rule.maxLength : null,
        pattern: typeof rule.pattern === "string" ? rule.pattern : null,
      };
    });
    const examples = implementation === "knowledge"
      ? simulationCases.filter((testCase) => testCase.skillId === skill.id).sort((left, right) => Number(right.id >= "SIM-QA-028") - Number(left.id >= "SIM-QA-028")).map(({ id, title, query }) => ({ id, title, query, caseId: id }))
      : ticketExamples[skill.id] ?? [];
    const sources = implementation === "knowledge"
      ? knowledgeDocuments.filter((source) => source.skillId === skill.id).map(({ id, title, documentNumber, owner, version, effectiveDate, dataKind }) => ({
        id, title, documentNumber, owner, version, effectiveDate, dataKind, url: `/knowledge/${id}`,
      }))
      : [];

    return {
      ...skill,
      evaluation: skillEvaluationProfile(skill),
      implementation,
      ...(implementation === "knowledge" ? { knowledgeBase: knowledgeBaseForSkill(skill.id) } : {}),
      storageBackend: implementation === "ticket_create" || implementation === "ticket_lookup" ? stateBackend() : null,
      inputLocation: implementation === "knowledge" || implementation === "unavailable" ? "request" : "parameters",
      inputSchema,
      inputs,
      resultTypes: resultTypes[implementation],
      examples,
      sources,
    };
  });
}