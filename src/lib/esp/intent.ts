import type { IntentContext, Permission, RouteResult, SkillDefinition, SkillParameters } from "./contracts";
import { skillParametersSchema } from "./contracts";
import { inferIntent, intentDraftSchema, type IntentModelInput } from "./intent-model";
import { skillRegistry } from "./registry";
import { routeSkill } from "./router";
import { ticketIdsInQuery } from "./ticket-input";
import { skillPluginOperation } from "./plugin-registry";
import { ticketGuidanceWorkflow } from "./workflow-contracts";

type IntentOptions = {
  selectedSkillId?: string;
  parameters?: SkillParameters;
  allowWorkflow?: boolean;
};

export type InterpretedRequest = { route: RouteResult; intent: IntentContext };

function selectedRoute(skill: SkillDefinition): RouteResult {
  return {
    status: "matched", skill, confidence: null, matchedKeywords: [],
    requiresConfirmation: skill.confirmationRequired,
  };
}

function noMatch(reason = "未找到当前请求可用的技能。"): RouteResult {
  return { status: "no_match", confidence: 0, reason };
}

function parallelRequestBlocked(query: string) {
  return /(?:不要|不必|无需|别|don't|do not|not)\s*(?:同时|分别|一并|both|in parallel|查|回答|处理|query|check|answer)|只(?:需|要)?(?:查|回答|处理)|仅(?:查|回答|处理)|\bonly (?:answer|check|query)\b/i.test(query) ||
    /还是|或者|或是|\beither\b|\bor\b/i.test(query) ||
    /然后|先[\s\S]{0,150}(?:再|后)|根据[\s\S]{0,80}结果|如果|成功后|查完|\bthen\b|\bafter that\b|\bdepending on\b|\bbased on[\s\S]{0,40}result\b|\bif\b/i.test(query);
}

function mayContainMultipleRequests(query: string) {
  return query.split(/[?？!！;；。\n]+/u).filter((part) => part.trim().length >= 3).length > 1 ||
    /同时|分别|一并|都要|都查询|以及|还有|另外|[和与及、，,]|\band\b|\balso\b|\bboth\b|\bin parallel\b|\bas well as\b/i.test(query) || parallelRequestBlocked(query);
}

function ticketGuidanceCandidate(query: string) {
  return /工单|\bticket\b/i.test(query) && /规范|指引|处理步骤|处理流程|guidance|guidelines|handling rules/i.test(query) &&
    /根据|结合|依据|基于|查完|然后|先[\s\S]*再|\bthen\b|\bbased on\b|\busing\b/i.test(query) &&
    !/不要|不必|无需|别查|只查|只要|仅查|还是|或者|如果|否则|\beither\b|\bor\b|\bif\b|\bdon't\b|\bdo not\b|\bonly\b/i.test(query);
}

function fixedWorkflowRoute(query: string, draft: ReturnType<typeof intentDraftSchema.parse>, permitted: boolean): RouteResult {
  if (!permitted || draft.workflowId !== ticketGuidanceWorkflow.id || !draft.workflowEvidence?.trim() || !query.includes(draft.workflowEvidence) || !ticketGuidanceCandidate(draft.workflowEvidence) ||
    draft.skillId !== null || draft.candidateIds.length || draft.tasks.length || draft.parallelEvidence !== null || draft.description !== null || draft.device !== null || draft.impact !== null || draft.impactEvidence !== null || draft.ticketId !== null) {
    return noMatch("请求未通过固定只读流程检查，请明确工单编号与需要查询的 IT 规范；额外事项请单独提交。");
  }
  return { status: "workflow", workflowId: ticketGuidanceWorkflow.id, version: ticketGuidanceWorkflow.version };
}

function parallelRoute(query: string, draft: ReturnType<typeof intentDraftSchema.parse>, skills: SkillDefinition[], permitted: boolean): RouteResult {
  const reject = () => noMatch("无法安全并行处理全部事项，请分别提交独立的只读问题；写入仍需单独确认或审批。");
  if (!permitted || !draft.parallelEvidence?.trim() || !query.includes(draft.parallelEvidence) ||
    draft.tasks.length < 2 || draft.tasks.length > 3 || new Set(draft.tasks.map((task) => task.skillId)).size !== draft.tasks.length ||
    draft.skillId !== null || draft.candidateIds.length) return reject();
  const tasks: Extract<RouteResult, { status: "parallel" }>["tasks"] = [];
  const spans: { start: number; end: number }[] = [];
  for (const task of draft.tasks) {
    const skill = skills.find((entry) => entry.id === task.skillId);
    const start = query.indexOf(task.query);
    const end = start + task.query.length;
    if (!skill || skill.confirmationRequired || skillPluginOperation(skill.id)?.effect !== "read" || start < 0 || task.query.trim().length < 3 ||
      spans.some((span) => start < span.end && end > span.start)) return reject();
    spans.push({ start, end });
    const ticketIds = skill.id === "get-ticket-status" ? ticketIdsInQuery(task.query) : [];
    tasks.push({ skill, query: task.query, parameters: ticketIds.length === 1 ? { ticketId: ticketIds[0] } : {} });
  }
  return { status: "parallel", tasks };
}

export async function interpretRequest(
  query: string,
  permissions: Permission[],
  options: IntentOptions = {},
  infer: (input: IntentModelInput) => Promise<unknown> = inferIntent,
): Promise<InterpretedRequest> {
  const allowedSkills = skillRegistry.filter((skill) => skill.permissions.every((permission) => permissions.includes(permission)));
  let route = routeSkill(query, permissions);
  let source: IntentContext["source"] = "keyword";
  const parameters = skillParametersSchema.parse(options.parameters ?? {});
  const ticketIds = ticketIdsInQuery(query);
  if (!parameters.ticketId && ticketIds.length === 1) parameters.ticketId = ticketIds[0];

  if (options.selectedSkillId) {
    const selected = allowedSkills.find((skill) => skill.id === options.selectedSkillId);
    if (!selected) return { route: noMatch(), intent: { source: "selection", parameters: {} } };
    route = selectedRoute(selected);
    source = "selection";
  }

  if (!allowedSkills.length || !query.trim()) return { route, intent: { source, parameters } };

  const normalized = query.toLocaleLowerCase();
  const hasWriteKeyword = skillRegistry.some((skill) => skillPluginOperation(skill.id)?.effect === "write" && skill.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase())));
  const workflowCandidate = ticketGuidanceCandidate(query);
  const allowWorkflow = options.allowWorkflow !== false && !options.selectedSkillId && options.parameters === undefined && !hasWriteKeyword && workflowCandidate &&
    ticketGuidanceWorkflow.permissions.every((permission) => permissions.includes(permission)) &&
    ticketGuidanceWorkflow.steps.every((step) => allowedSkills.some((skill) => skill.id === step.skillId && !skill.confirmationRequired && skillPluginOperation(skill.id)?.id === step.operationId));
  const allowParallel = !options.selectedSkillId && options.parameters === undefined && !parallelRequestBlocked(query) &&
    !hasWriteKeyword && !workflowCandidate;
  const matchingSkills = allowedSkills.filter((skill) =>
    skill.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase())),
  );
  const needsRouting = !options.selectedSkillId && (route.status === "no_match" || matchingSkills.length > 1 || allowWorkflow ||
    route.status === "matched" && skillPluginOperation(route.skill.id)?.effect === "read" && mayContainMultipleRequests(query));
  const needsParameters = route.status === "matched" && route.skill.id === "create-it-ticket" && options.parameters === undefined;
  if (!needsRouting && !needsParameters) return { route, intent: { source, parameters } };

  const fixedSkill = !needsRouting && route.status === "matched" ? route.skill : undefined;
  let draft: ReturnType<typeof intentDraftSchema.parse>;
  try {
    draft = intentDraftSchema.parse(await infer({
      query,
      skills: fixedSkill ? [fixedSkill] : allowedSkills,
      fixedSkillId: fixedSkill?.id,
      allowParallel,
      allowWorkflow,
    }));
  } catch (error) {
    if (fixedSkill?.id === "create-it-ticket") {
      return { route, intent: { source, parameters, notice: "manual_input" } };
    }
    throw error;
  }

  if (needsRouting) {
    source = "model";
    if (draft.decision === "workflow") return { route: fixedWorkflowRoute(query, draft, allowWorkflow), intent: { source, parameters: {} } };
    if (draft.workflowId !== null || draft.workflowEvidence !== null) return { route: noMatch("意图结果不一致，请明确本次需要处理的事项。"), intent: { source, parameters: {} } };
    if (draft.decision === "parallel") {
      return { route: parallelRoute(query, draft, allowedSkills, allowParallel), intent: { source, parameters: {} } };
    }
    if (draft.decision === "clarify") {
      const choices = [...new Set(draft.candidateIds)]
        .flatMap((id) => allowedSkills.filter((skill) => skill.id === id).map(({ id, name }) => ({ id, name })));
      if (choices.length >= 2) {
        return {
          route: noMatch("请求涉及多个可能的事项，请先选择。"),
          intent: { source, parameters: {}, choices, question: draft.question?.trim() || "请选择本次要办理的事项。" },
        };
      }
      return { route: noMatch(), intent: { source, parameters: {} } };
    }
    const chosen = draft.decision === "matched" ? allowedSkills.find((skill) => skill.id === draft.skillId) : undefined;
    if (!chosen) return { route: noMatch(), intent: { source, parameters: {} } };
    route = selectedRoute(chosen);
  }

  if (route.status === "matched" && route.skill.id === "create-it-ticket" && draft.skillId === route.skill.id) {
    const isLiteral = (value: string | null) => !!value?.trim() && normalized.includes(value.trim().toLocaleLowerCase());
    if (isLiteral(draft.description) && !parameters.description) parameters.description = draft.description!.trim();
    if (isLiteral(draft.device) && !parameters.device) parameters.device = draft.device!.trim();
    if (draft.impact && isLiteral(draft.impactEvidence) && !parameters.impact) parameters.impact = draft.impact;
  }

  return { route, intent: { source, parameters } };
}