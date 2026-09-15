import { z } from "zod";
import type { Permission } from "./contracts";
import { pluginInputSchemas, pluginOutputSchemas, type PluginCatalogEntry } from "./plugin-contracts";
import { builtinPlugins, pluginOperations, type BuiltinPluginId, type PluginOperationId } from "./plugin-registry";
import { skillRegistry } from "./registry";
import { simulationCases } from "./simulation-cases";
import { stateBackend } from "./state-config";
import { enterpriseData } from "./enterprise-data";

const dependencyDefinitions = {
  search: { name: "Azure AI Search", settings: ["AZURE_SEARCH_ENDPOINT"] },
  foundry: { name: "Azure AI Foundry", settings: ["AZURE_AI_ENDPOINT", "AZURE_AI_CHAT_DEPLOYMENT"] },
  blob: { name: "Azure Blob Storage", settings: ["AZURE_STORAGE_ACCOUNT"] },
  postgres: { name: "PostgreSQL transaction state", settings: ["POSTGRES_HOST", "POSTGRES_DATABASE", "POSTGRES_USER", "POSTGRES_PASSWORD"] },
} as const;
const pluginDependencies: Record<BuiltinPluginId, (keyof typeof dependencyDefinitions)[]> = {
  knowledge: ["search", "foundry", "blob"], tickets: ["blob"],
};

const ticketExamples: Partial<Record<PluginOperationId, PluginCatalogEntry["operations"][number]["examples"]>> = {
  "tickets.get": [
    { id: "ticket-required-id", title: "缺少工单编号", skillId: "get-ticket-status", input: { query: "查询工单状态", parameters: {} } },
    { id: "ticket-test-id", title: "未创建编号：应返回未找到", skillId: "get-ticket-status", input: { query: "查询未创建的 DEV 工单；SIM-SR 台账编号不是执行回执", parameters: { ticketId: "ESP-20260910-00000000" } } },
  ],
  "tickets.create": [
    ...enterpriseData.serviceRequests.map((request) => ({ id: request.id, title: request.title, skillId: "create-it-ticket", input: { query: request.description, parameters: { description: request.description, impact: request.impact, ...(request.assetId ? { device: request.assetId } : {}) } } })),
    { id: "ticket-missing-fields", title: "缺少必填信息", skillId: "create-it-ticket", input: { query: "创建工单", parameters: {} } },
  ],
};

export function getPluginCatalog(permissions: Permission[], environment: Readonly<Record<string, string | undefined>> = process.env): PluginCatalogEntry[] {
  return builtinPlugins.flatMap((plugin) => {
    const operations = pluginOperations.filter((operation) => operation.pluginId === plugin.id && operation.permissions.every((permission) => permissions.includes(permission))).flatMap((operation) => {
      const skills = skillRegistry.filter((skill) => operation.skillIds.some((id) => id === skill.id) && skill.permissions.every((permission) => permissions.includes(permission)));
      if (!skills.length) return [];
      const examples = operation.id === "knowledge.answer"
        ? skills.flatMap((skill) => simulationCases.filter((sample) => sample.skillId === skill.id).sort((left, right) => Number(right.id >= "SIM-QA-028") - Number(left.id >= "SIM-QA-028")).map((sample) => ({
          id: sample.id, title: sample.title, skillId: skill.id, input: { query: sample.query },
        })))
        : ticketExamples[operation.id] ?? [];
      return [{
        id: operation.id, name: operation.name, description: operation.description, effect: operation.effect, permissions: [...operation.permissions],
        trialMode: operation.effect === "write" ? "write_preview" as const : "live_read" as const,
        skills: skills.map(({ id, name, confirmationRequired }) => ({ id, name, confirmationRequired })),
        inputSchema: z.toJSONSchema(pluginInputSchemas[operation.id], { io: "input" }), outputSchema: z.toJSONSchema(pluginOutputSchemas[operation.id]),
        resultTypes: [...operation.resultTypes], examples,
      }];
    });
    if (!operations.length) return [];
    return [{
      ...plugin, contractVersion: "1.0" as const, runtime: "builtin" as const, state: "registered" as const, operations,
      dependencies: (plugin.id === "tickets" && stateBackend(environment) === "postgres" ? ["postgres", "blob"] as const : pluginDependencies[plugin.id]).map((id) => {
        const definition = dependencyDefinitions[id];
        const settings = id === "postgres" && environment.POSTGRES_SECRET_URI
          ? ["POSTGRES_HOST", "POSTGRES_DATABASE", "POSTGRES_USER", "POSTGRES_SECRET_URI", "KEY_VAULT_URI"]
          : definition.settings;
        const requiredSettings = settings.map((name) => ({ name, present: Boolean(environment[name]?.trim()) }));
        return { id, name: definition.name, configured: requiredSettings.every((setting) => setting.present), requiredSettings, health: "not_checked" as const };
      }),
    }];
  });
}