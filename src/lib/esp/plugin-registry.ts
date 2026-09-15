import type { ExecutionResult, Permission } from "./contracts";
import { knowledgeSkillIds } from "./knowledge-corpus";

export type BuiltinPluginId = "knowledge" | "tickets";
export type PluginOperationId = "knowledge.answer" | "tickets.get" | "tickets.create";

type PluginOperationDefinition = {
  id: PluginOperationId;
  pluginId: BuiltinPluginId;
  name: string;
  description: string;
  kind: "knowledge" | "ticket_lookup" | "ticket_create";
  effect: "read" | "write";
  permissions: readonly Permission[];
  skillIds: readonly string[];
  resultTypes: readonly ExecutionResult["type"][];
};

export const builtinPlugins = [
  { id: "knowledge", name: "Knowledge", description: "模拟制度检索与带原文引用的知识回答。", version: "0.1.0" },
  { id: "tickets", name: "Ticket", description: "DEV 工单持久化创建与所属人范围内的状态查询。", version: "0.1.0" },
] as const;

export const pluginOperations = [
  {
    id: "knowledge.answer", pluginId: "knowledge", name: "检索知识", description: "检索当前发布的资料，返回经过校验的原文引用或资料不足结果。",
    kind: "knowledge", effect: "read", permissions: ["knowledge.read"], skillIds: knowledgeSkillIds,
    resultTypes: ["knowledge_answer", "knowledge_not_found"],
  },
  {
    id: "tickets.get", pluginId: "tickets", name: "查询工单", description: "按工单编号读取当前身份所属的记录，不返回其他身份的工单。",
    kind: "ticket_lookup", effect: "read", permissions: ["tickets.read"], skillIds: ["get-ticket-status"],
    resultTypes: ["ticket_status", "ticket_not_found", "input_required"],
  },
  {
    id: "tickets.create", pluginId: "tickets", name: "创建工单", description: "将确认后的故障描述、影响范围与设备信息保存为 DEV 工单。",
    kind: "ticket_create", effect: "write", permissions: ["tickets.create"], skillIds: ["create-it-ticket"],
    resultTypes: ["ticket_created", "ticket_details_required"],
  },
] as const satisfies readonly PluginOperationDefinition[];

export function skillPluginOperation(skillId: string) {
  return pluginOperations.find((operation) => operation.skillIds.some((known) => known === skillId)) ?? null;
}