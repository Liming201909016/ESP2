import { skillUsageSchema, type ExecutionStatus, type IntentContext, type RouteResult, type SkillUsage } from "./contracts";
import { builtinPlugins, skillPluginOperation } from "./plugin-registry";
import { knowledgeBaseForSkill } from "./knowledge-corpus";

export type SkillExecutionKind = "knowledge" | "ticket_lookup" | "ticket_create" | "unavailable";

export function skillExecutionKind(skillId: string): SkillExecutionKind {
  return skillPluginOperation(skillId)?.kind ?? "unavailable";
}

export function describeSkillUsage({ route, intent, executionStatus, invoked, receiptReused }: {
  route: RouteResult;
  intent: IntentContext;
  executionStatus: ExecutionStatus;
  invoked: boolean;
  receiptReused: boolean;
}): SkillUsage[] {
  if (route.status !== "matched" || intent.choices?.length) return [];
  const operation = skillPluginOperation(route.skill.id);
  const plugin = builtinPlugins.find((entry) => entry.id === operation?.pluginId);
  return [skillUsageSchema.parse({
    skillId: route.skill.id, name: route.skill.name, description: route.skill.description,
    version: route.skill.version, category: route.skill.category, riskLevel: route.skill.riskLevel,
    selectionSource: intent.source, matchedKeywords: route.matchedKeywords,
    ...(operation?.kind === "knowledge" ? { knowledgeBase: knowledgeBaseForSkill(route.skill.id) } : {}),
    plugin: operation && plugin ? {
      id: plugin.id, name: plugin.name, version: plugin.version,
      operationId: operation.id, operationName: operation.name, effect: operation.effect,
    } : null,
    invoked: invoked && Boolean(operation), receiptReused, executionStatus,
  })];
}