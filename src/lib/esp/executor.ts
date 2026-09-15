import { skillParametersSchema, type ExecutionResult, type SkillParameters } from "./contracts";
import { invokePlugin, type PluginDependencies } from "./plugin-execution";
import { skillPluginOperation } from "./plugin-registry";

export async function executeSkill(
  skillId: string,
  query: string,
  createdBy: string,
  dependencies: Partial<PluginDependencies> = {},
  input: SkillParameters = {},
): Promise<ExecutionResult> {
  const parameters = skillParametersSchema.parse(input);
  const operation = skillPluginOperation(skillId);
  if (!operation) return { type: "unavailable", skillId };
  return invokePlugin(operation.id, { skillId, query, createdBy, parameters }, dependencies);
}