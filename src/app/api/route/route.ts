import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApprovalError, type ApprovalDetail } from "../../../lib/esp/approval-contracts";
import { evaluateTicketPolicy } from "../../../lib/esp/approval-policy";
import { approvalDetails, submitApproval } from "../../../lib/esp/approval-workflow";
import { auditedResponse } from "../../../lib/esp/audit-http";
import { auditInput, type AuditContext } from "../../../lib/esp/audit-operation";
import { skillParametersSchema, skillQuerySchema, ticketDetailsSchema, type ExecutionResult, type ExecutionStatus } from "../../../lib/esp/contracts";
import { executeSkill } from "../../../lib/esp/executor";
import { resolveIdentity, type IdentityContext } from "../../../lib/esp/identity";
import { interpretRequest, type InterpretedRequest } from "../../../lib/esp/intent";
import { missingTicketFields } from "../../../lib/esp/ticket-input";
import { skillRegistry } from "../../../lib/esp/registry";
import { StateMaintenanceError } from "../../../lib/esp/state-config";
import { modelRateLimit } from "../../../lib/esp/model-rate-limit";
import { describeSkillUsage, skillExecutionKind } from "../../../lib/esp/skill-execution";
import { KnowledgeVerificationError } from "../../../lib/esp/knowledge-grounding";
import { executeParallelRead, ParallelReadPlanError } from "../../../lib/esp/parallel-read";
import { executeTicketGuidance, WorkflowAccessError } from "../../../lib/esp/workflow";
import { executeConfirmedTicket, prepareTicketConfirmation, TicketConfirmationError } from "../../../lib/esp/ticket-confirmation";
import { AuditStartError } from "../../../lib/esp/audit-contracts";

const requestSchema = z.object({
  query: skillQuerySchema,
  confirmed: z.boolean().optional().default(false),
  selectedSkillId: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  parameters: skillParametersSchema.optional(),
  submissionId: z.uuid().optional(),
  confirmationId: z.uuid().optional(),
});

const executionStatuses: Record<ExecutionResult["type"], ExecutionStatus> = {
  ticket_created: "completed",
  ticket_status: "completed",
  knowledge_answer: "completed",
  knowledge_not_found: "no_evidence",
  input_required: "needs_input",
  ticket_details_required: "needs_input",
  intent_clarification: "needs_input",
  ticket_not_found: "not_found",
  unavailable: "unavailable",
};

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  const identity = resolveIdentity(request.headers);
  const selected = parsed.success ? skillRegistry.find((skill) => skill.id === parsed.data.selectedSkillId) : undefined;
  return auditedResponse(request, {
    identity, kind: "skill_request", action: "route",
    mutation: parsed.success && parsed.data.confirmed && identity.authenticated && identity.permissions.includes("tickets.create"),
    input: parsed.success ? auditInput({ query: parsed.data.query, parameters: parsed.data.parameters, confirmed: parsed.data.confirmed }) : { fields: [] },
    requiredPermissions: selected?.permissions ?? [], references: selected ? [{ type: "skill", id: selected.id, version: selected.version }] : [],
  }, (context) => handleRoute(parsed, identity, context));
}

async function handleRoute(parsed: ReturnType<typeof requestSchema.safeParse>, identity: IdentityContext, context: AuditContext) {
  const { requestId } = context;

  if (!parsed.success) {
    return NextResponse.json(
      { requestId, error: "INVALID_REQUEST", details: parsed.error.flatten(), skillUsage: [] },
      { status: 400 },
    );
  }

  if (!identity.authenticated) {
    return NextResponse.json(
      { requestId, error: "AUTHENTICATION_REQUIRED", skillUsage: [] },
      { status: 401 },
    );
  }

  const trace = [{ step: "request.validated", at: new Date().toISOString() }];
  let interpreted: InterpretedRequest;
  try {
    interpreted = await interpretRequest(parsed.data.query, identity.permissions, {
      selectedSkillId: parsed.data.selectedSkillId,
      parameters: parsed.data.parameters,
      allowWorkflow: !parsed.data.confirmed && Boolean(identity.subject),
    });
  } catch (error) {
    const limited = modelRateLimit(error);
    console.error("Intent interpretation failed", { requestId, name: error instanceof Error ? error.name : "UnknownError" });
    trace.push({ step: limited ? "intent.rate_limited" : "intent.failed", at: new Date().toISOString() });
    return NextResponse.json({ requestId, error: limited ? "MODEL_RATE_LIMITED" : "INTENT_UNAVAILABLE", ...limited, executionStatus: "failed", skillUsage: [], trace }, {
      status: limited ? 429 : 502, headers: limited ? { "Retry-After": String(limited.retryAfterSeconds) } : {},
    });
  }

  const { route, intent } = interpreted;
  trace.push({ step: `intent.${intent.source}`, at: new Date().toISOString() });
  if (route.status === "workflow") {
    try {
      if (parsed.data.confirmed || parsed.data.selectedSkillId || parsed.data.parameters) throw new WorkflowAccessError("WORKFLOW_BINDING_INVALID", 400);
      trace.push({ step: "workflow.selected", at: new Date().toISOString() });
      const workflow = await executeTicketGuidance({ workflowId: route.workflowId, query: parsed.data.query }, identity, context, { selectionSource: "model" });
      trace.push(...workflow.steps.map((step) => ({ step: `workflow.${step.id}.${step.status}${step.skipReason ? `.${step.skipReason}` : ""}`, at: step.completedAt ?? new Date().toISOString() })));
      return NextResponse.json({ requestId, route, intent, workflow, executionStatus: workflow.executionStatus, execution: null,
        skillUsage: workflow.steps.flatMap((step) => step.usage ? [step.usage] : []), policy: null, approval: null,
        identity: { displayName: identity.displayName, source: identity.source }, trace,
        ...(workflow.executionStatus === "failed" ? { error: "WORKFLOW_EXECUTION_FAILED" } : {}),
      }, { status: workflow.executionStatus === "failed" ? 502 : 200 });
    } catch (error) {
      const rejected = error instanceof WorkflowAccessError;
      trace.push({ step: rejected ? "workflow.rejected" : "workflow.failed", at: new Date().toISOString() });
      return NextResponse.json({ requestId, executionStatus: "failed", error: rejected ? error.code : "WORKFLOW_UNAVAILABLE", ...(rejected ? { skillUsage: [] } : {}), trace }, { status: rejected ? error.status : 502 });
    }
  }
  if (route.status === "parallel") {
    try {
      if (parsed.data.confirmed) throw new ParallelReadPlanError();
      trace.push({ step: "parallel.planned", at: new Date().toISOString() });
      const parallel = await executeParallelRead(route.tasks, identity, context);
      trace.push({ step: `parallel.${parallel.executionStatus}`, at: new Date().toISOString() });
      return NextResponse.json({
        requestId, executionStatus: parallel.executionStatus, execution: null, parallel,
        skillUsage: parallel.tasks.map((task) => task.usage), route, intent, policy: null, approval: null,
        identity: { displayName: identity.displayName, source: identity.source }, trace,
        ...(parallel.executionStatus === "failed" ? { error: "PARALLEL_READ_FAILED" } : {}),
      }, { status: parallel.executionStatus === "failed" ? 502 : 200 });
    } catch (error) {
      const rejected = error instanceof ParallelReadPlanError;
      trace.push({ step: rejected ? "parallel.rejected" : "parallel.failed", at: new Date().toISOString() });
      return NextResponse.json({ requestId, executionStatus: "failed", error: rejected ? error.code : "PARALLEL_READ_UNAVAILABLE", ...(rejected ? { skillUsage: [] } : {}), trace }, {
        status: rejected ? 400 : 502,
      });
    }
  }
  trace.push({ step: route.status === "matched" ? "skill.matched" : "skill.not_matched", at: new Date().toISOString() });
  let executionStatus: ExecutionStatus = route.status === "matched" ? "unavailable" : "not_routed";
  let execution: ExecutionResult | null = null;
  let approval: ApprovalDetail | null = null;
  let invoked = false;
  let receiptReused = false;
  let confirmation: Awaited<ReturnType<typeof prepareTicketConfirmation>> | null = null;
  const currentSkillUsage = (status: ExecutionStatus = executionStatus) => describeSkillUsage({ route, intent, executionStatus: status, invoked, receiptReused });
  const policy = route.status === "matched" && route.skill.id === "create-it-ticket" ? evaluateTicketPolicy(intent.parameters) : null;
  if (policy) trace.push({ step: `policy.${policy.effect}_required`, at: new Date().toISOString() });

  if (intent.choices?.length) {
    execution = { type: "intent_clarification", question: intent.question ?? "请选择要办理的事项。", choices: intent.choices };
    executionStatus = "needs_input";
    trace.push({ step: "intent.awaiting_selection", at: new Date().toISOString() });
  } else if (route.status === "matched" && route.skill.id === "create-it-ticket") {
    const missingFields = missingTicketFields(intent.parameters);
    if (missingFields.length) {
      execution = { type: "ticket_details_required", parameters: intent.parameters, missingFields };
      executionStatus = "needs_input";
      trace.push({ step: "parameters.awaiting_input", at: new Date().toISOString() });
    }
  }

  if (!execution && route.status === "matched" && route.requiresConfirmation && !parsed.data.confirmed) {
    executionStatus = "waiting_confirmation";
  }

  if (executionStatus === "waiting_confirmation") {
    if (policy?.effect === "confirmation") {
      try {
        confirmation = await prepareTicketConfirmation(parsed.data.query, ticketDetailsSchema.parse(intent.parameters), identity, context, parsed.data.submissionId);
      } catch (error) {
        return NextResponse.json({ requestId, error: error instanceof TicketConfirmationError || error instanceof StateMaintenanceError ? error.code : error instanceof AuditStartError ? "AUDIT_START_FAILED" : "CONFIRMATION_UNAVAILABLE", executionStatus: "failed", skillUsage: currentSkillUsage("failed"), trace }, { status: error instanceof TicketConfirmationError ? error.status : 503 });
      }
    }
    trace.push({ step: "execution.awaiting_confirmation", at: new Date().toISOString() });
  }

  if (!execution && route.status === "matched" && policy?.effect === "approval" && parsed.data.confirmed) {
    try {
      const stored = await submitApproval(parsed.data.query, ticketDetailsSchema.parse({
        description: intent.parameters.description, device: intent.parameters.device, impact: intent.parameters.impact,
      }), parsed.data.submissionId ?? randomUUID(), identity);
      approval = approvalDetails(stored, identity);
      executionStatus = "waiting_approval";
      if (approval.record.status === "completed" && approval.record.ticket) {
        executionStatus = "completed";
        execution = { type: "ticket_created", ticket: approval.record.ticket };
        receiptReused = true;
      }
      trace.push({ step: `approval.${approval.record.status}`, at: new Date().toISOString() });
    } catch (error) {
      trace.push({ step: "approval.submission_failed", at: new Date().toISOString() });
      console.error("approval.submission.failed", { requestId, name: error instanceof Error ? error.name : "UnknownError" });
      return NextResponse.json({ requestId, error: error instanceof ApprovalError || error instanceof StateMaintenanceError ? error.code : "APPROVAL_SERVICE_FAILED", executionStatus: "failed", skillUsage: currentSkillUsage("failed"), policy, trace }, { status: error instanceof ApprovalError ? error.status : error instanceof StateMaintenanceError ? 503 : 502 });
    }
  }

  if (
    !execution &&
    route.status === "matched" &&
    policy?.effect !== "approval" &&
    (!route.requiresConfirmation || parsed.data.confirmed)
  ) {
    trace.push({ step: "execution.started", at: new Date().toISOString() });
    try {
      if (route.skill.id === "create-it-ticket") {
        const result = await executeConfirmedTicket(parsed.data.confirmationId, parsed.data.query, ticketDetailsSchema.parse(intent.parameters), identity, {
          execute: (...args) => { invoked = true; return executeSkill(...args); },
        });
        execution = result.execution; receiptReused = result.receiptReused;
      } else {
        invoked = skillExecutionKind(route.skill.id) !== "unavailable";
        execution = await executeSkill(
        route.skill.id,
        parsed.data.query,
        identity.subject ?? "unknown",
        {},
        intent.parameters,
        );
      }
      if (execution.type === "unavailable") invoked = false;
      executionStatus = executionStatuses[execution.type];
      trace.push({ step: `execution.${executionStatus}`, at: new Date().toISOString() });
    } catch (error) {
      const limited = modelRateLimit(error);
      const verification = error instanceof KnowledgeVerificationError ? error.reason : null;
      const azureError = error as Error & { code?: string; statusCode?: number };
      console.error("Skill execution failed", {
        requestId,
        skillId: route.skill.id,
        code: azureError.code,
        statusCode: azureError.statusCode,
        error: verification ? "KNOWLEDGE_VERIFICATION_FAILED" : limited ? "MODEL_RATE_LIMITED" : azureError.message ?? "Unknown error",
        ...(verification ? { verificationReason: verification } : {}),
      });
      trace.push({ step: verification ? `knowledge.verification.${verification}` : limited ? "execution.rate_limited" : "execution.failed", at: new Date().toISOString() });
      return NextResponse.json(
        { requestId, error: verification ? "KNOWLEDGE_VERIFICATION_FAILED" : limited ? "MODEL_RATE_LIMITED" : error instanceof StateMaintenanceError || error instanceof TicketConfirmationError ? error.code : "EXECUTION_FAILED", ...limited, ...(verification ? { verificationReason: verification } : {}), executionStatus: "failed", skillUsage: currentSkillUsage("failed"), trace },
        { status: limited ? 429 : error instanceof TicketConfirmationError ? error.status : error instanceof StateMaintenanceError ? 503 : 502, headers: limited ? { "Retry-After": String(limited.retryAfterSeconds) } : {} },
      );
    }
  }

  return NextResponse.json({
    requestId,
    executionStatus,
    skillUsage: currentSkillUsage(),
    execution,
    policy,
    approval,
    confirmation,
    intent,
    identity: {
      displayName: identity.displayName,
      source: identity.source,
    },
    route,
    trace,
  });
}