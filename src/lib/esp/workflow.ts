import { auditInput, runAudited, type AuditContext, type AuditWriter } from "./audit-operation";
import { auditOutcome } from "./audit-http";
import { auditWriter } from "./audit-store";
import { skillQuerySchema, type SkillParameters } from "./contracts";
import { executeSkill } from "./executor";
import type { IdentityContext } from "./identity";
import { KnowledgeVerificationError } from "./knowledge-grounding";
import { answerKnowledge } from "./knowledge";
import { retrieveKnowledge } from "./knowledge-search";
import { generateGroundedAnswer, reviewGroundedAnswer, incidentPolicyQuestion, type IncidentPolicyContext } from "./knowledge-model";
import { modelRateLimit } from "./model-rate-limit";
import { pluginOutputSchemas } from "./plugin-contracts";
import { skillPluginOperation } from "./plugin-registry";
import { skillRegistry } from "./registry";
import { describeSkillUsage } from "./skill-execution";
import { ticketIdsInQuery } from "./ticket-input";
import { ticketGuidanceQuery, ticketGuidanceWorkflow, workflowRequestSchema, workflowResultSchema, type WorkflowStep } from "./workflow-contracts";

export class WorkflowAccessError extends Error {
  constructor(public readonly code: "AUTHENTICATION_REQUIRED" | "PERMISSION_REQUIRED" | "SUBJECT_REQUIRED" | "WORKFLOW_BINDING_INVALID", public readonly status: number) { super(code); }
}

export function workflowSkills(identity: IdentityContext) {
  if (!identity.authenticated) throw new WorkflowAccessError("AUTHENTICATION_REQUIRED", 401);
  if (!identity.subject) throw new WorkflowAccessError("SUBJECT_REQUIRED", 403);
  if (!ticketGuidanceWorkflow.permissions.every((permission) => identity.permissions.includes(permission))) throw new WorkflowAccessError("PERMISSION_REQUIRED", 403);
  return ticketGuidanceWorkflow.steps.map((step) => {
    const skill = skillRegistry.find((entry) => entry.id === step.skillId);
    const operation = skill && skillPluginOperation(skill.id);
    if (!skill || !operation || operation.id !== step.operationId || operation.effect !== "read" || skill.confirmationRequired) throw new WorkflowAccessError("WORKFLOW_BINDING_INVALID", 503);
    if (![...skill.permissions, ...operation.permissions].every((permission) => identity.permissions.includes(permission))) throw new WorkflowAccessError("PERMISSION_REQUIRED", 403);
    return { skill, operation };
  });
}

export async function executeTicketGuidance(input: unknown, identity: IdentityContext, parent: AuditContext, dependencies: { execute?: typeof executeSkill; writer?: AuditWriter; selectionSource?: "model" | "selection" } = {}) {
  const request = workflowRequestSchema.parse(input);
  workflowSkills(identity);
  const execute = dependencies.execute ?? executeSkill;
  const writer = dependencies.writer ?? auditWriter;
  const subject = identity.subject!;
  const ids = ticketIdsInQuery(request.query);
  const parameters: SkillParameters = ids.length === 1 ? { ticketId: ids[0] } : {};

  async function run(index: 0 | 1, query: string, parameters: SkillParameters, originTicketId?: string, incidentBackground?: IncidentPolicyContext): Promise<WorkflowStep> {
    const { skill, operation } = workflowSkills(identity)[index];
    const started = performance.now(); const startedAt = new Date().toISOString();
    const route = { status: "matched" as const, skill, confidence: null, matchedKeywords: [], requiresConfirmation: false };
    const options = { identity, kind: "skill_request" as const, action: `workflow.${ticketGuidanceWorkflow.steps[index].id}`, mutation: false, traceId: parent.traceId,
      requiredPermissions: [...ticketGuidanceWorkflow.permissions], input: auditInput({ query, parameters }), references: [{ type: "skill" as const, id: skill.id, version: skill.version }, ...(originTicketId ? [{ type: "ticket" as const, id: originTicketId }] : [])] };
    const { value, receipt } = await runAudited(options, async ({ requestId }) => {
      let execution: WorkflowStep["execution"] = null;
      let status: WorkflowStep["status"] = "failed";
      let failure: Pick<WorkflowStep, "error" | "verificationReason" | "retryAfterSeconds"> = {};
      try {
        const knowledge = index === 1 ? {
          answerKnowledge: (skillId: string, question: string) => answerKnowledge(skillId, question, {
            retrieve: (id: string) => retrieveKnowledge(id, "企业软件目录 IT 服务台 工单受理 设备兼容性 核对要求 后续处理 审批规范", { policyOnly: true }),
            generate: (_query, documents, asOfDate) => generateGroundedAnswer(incidentPolicyQuestion, documents, asOfDate, incidentBackground),
            review: (_query, documents, input) => reviewGroundedAnswer(incidentPolicyQuestion, documents, input, incidentBackground),
          }),
        } : {};
        const result = pluginOutputSchemas[operation.id].parse(await execute(skill.id, query, subject, knowledge, parameters));
        if (index === 0 && (result.type === "ticket_status" && (result.ticket.id !== parameters.ticketId || result.ticket.createdBy !== subject) || result.type === "ticket_not_found" && result.ticketId !== parameters.ticketId || result.type === "input_required" && parameters.ticketId)) throw new Error("Invalid owner-scoped receipt");
        execution = result;
        status = result.type === "knowledge_not_found" ? "no_evidence" : result.type === "ticket_not_found" ? "not_found" : result.type === "input_required" ? "needs_input" : "completed";
      } catch (error) {
        const limited = modelRateLimit(error);
        failure = error instanceof KnowledgeVerificationError ? { error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: error.reason } : limited ? { error: "MODEL_RATE_LIMITED", ...limited } : { error: "READ_EXECUTION_FAILED" };
      }
      const usage = describeSkillUsage({ route, intent: { source: dependencies.selectionSource ?? "selection", parameters }, executionStatus: status, invoked: true, receiptReused: false })[0];
      const trace = [{ step: `workflow.${ticketGuidanceWorkflow.steps[index].id}.started`, at: startedAt }, { step: failure.verificationReason ? `knowledge.verification.${failure.verificationReason}` : `workflow.${status}`, at: new Date().toISOString() }];
      return { value: { requestId, execution, status, usage, ...failure }, outcome: auditOutcome({ executionStatus: status, execution, route, error: failure.error, trace }, status === "failed" ? limitedHttp(failure.error) : 200, options) };
    }, writer);
    return { ...value, id: ticketGuidanceWorkflow.steps[index].id, query, audit: receipt, startedAt, completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started) };
  }

  const ticket = await run(0, request.query, parameters);
  let guidance: WorkflowStep = { id: "guidance", status: "skipped", skipReason: "upstream_not_completed", query: null, execution: null, usage: null, requestId: null, audit: null, startedAt: null, completedAt: null, durationMs: 0 };
  if (ticket.execution?.type === "ticket_status" && ticket.status === "completed") {
    const next = skillQuerySchema.safeParse(ticketGuidanceQuery(ticket.execution.ticket));
    guidance = next.success ? await run(1, next.data, {}, ticket.execution.ticket.id, { summary: ticket.execution.ticket.summary, device: ticket.execution.ticket.details?.device ?? null }) : { ...guidance, skipReason: "context_too_large" };
  }
  return workflowResultSchema.parse({ requestId: parent.requestId, workflowId: ticketGuidanceWorkflow.id, version: ticketGuidanceWorkflow.version,
    executionStatus: ticket.status !== "completed" ? ticket.status : guidance.status === "completed" ? "completed" : "partial", steps: [ticket, guidance] });
}

function limitedHttp(error?: WorkflowStep["error"]) { return error === "MODEL_RATE_LIMITED" ? 429 : 502; }