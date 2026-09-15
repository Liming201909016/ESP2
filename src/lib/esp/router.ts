import type { Permission, RouteResult, SkillDefinition } from "./contracts";
import { skillRegistry } from "./registry";

function eligibleSkills(
  permissions: ReadonlySet<Permission>,
  registry: SkillDefinition[],
) {
  return registry.filter((skill) =>
    skill.permissions.every((permission) => permissions.has(permission)),
  );
}

export function routeSkill(
  query: string,
  grantedPermissions: Permission[],
  registry = skillRegistry,
): RouteResult {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return {
      status: "no_match",
      confidence: 0,
      reason: "请求内容不能为空。",
    };
  }

  const permissions = new Set(grantedPermissions);
  const ranked = eligibleSkills(permissions, registry)
    .map((skill) => ({
      skill,
      matchedKeywords: skill.keywords.filter((keyword) =>
        normalizedQuery.includes(keyword.toLocaleLowerCase()),
      ),
    }))
    .filter((candidate) => candidate.matchedKeywords.length > 0)
    .sort((left, right) =>
      right.matchedKeywords.length - left.matchedKeywords.length ||
      left.skill.id.localeCompare(right.skill.id),
    );

  const selected = ranked[0];
  if (!selected) {
    return {
      status: "no_match",
      confidence: 0,
      reason: "未找到当前用户有权使用的匹配技能。",
    };
  }

  return {
    status: "matched",
    skill: selected.skill,
    confidence: Math.min(0.98, 0.62 + selected.matchedKeywords.length * 0.12),
    matchedKeywords: selected.matchedKeywords,
    requiresConfirmation: selected.skill.confirmationRequired,
  };
}