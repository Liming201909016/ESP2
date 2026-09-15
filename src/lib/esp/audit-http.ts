import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditAccessError, AuditStartError, auditIdSchema, auditOutcomeSchema, auditReferenceSchema, type AuditOutcome, type AuditReference } from "./audit-contracts";
import { runAudited, type AuditContext, type AuditOptions, type AuditWriter } from "./audit-operation";
import { auditWriter, getAudit } from "./audit-store";
import { knowledgeMissingReasonSchema, permissionSchema, type Permission } from "./contracts";
import { builtinPlugins, skillPluginOperation } from "./plugin-registry";
import { ticketGuidanceWorkflow } from "./workflow-contracts";
import { skillRegistry } from "./registry";

const traceSchema = auditOutcomeSchema.shape.trace;
const approvalSummary = z.object({ id: z.string().regex(/^apr-[a-f0-9]{32}$/), status: auditOutcomeSchema.shape.status, ticket: z.object({ id: z.string() }).optional(), policy: z.object({ policyId: z.string(), version: z.string() }).optional() });
const auditSkillSchema = z.object({ id: z.string(), version: z.string(), permissions: z.array(permissionSchema) });
const executionEvidenceSchema = z.object({
  reason: z.unknown().optional(),
  type: z.string(), ticketId: z.string().optional(), ticket: z.object({ id: z.string(), approvalId: z.string().optional() }).optional(),
  citations: z.array(z.object({ id: z.string(), version: z.string() })).max(5).optional(),
});
const businessSchema = z.object({
  reviewRecord: z.object({ id: z.string().regex(/^sr-[a-f0-9]{32}$/), policyVersion: z.string() }).optional(),
  executionStatus: auditOutcomeSchema.shape.status.optional(), status: auditOutcomeSchema.shape.status.optional(), error: auditOutcomeSchema.shape.errorCode.optional(), trace: traceSchema.optional(),
  route: z.object({ skill: auditSkillSchema.optional(), tasks: z.array(z.object({ skill: auditSkillSchema })).max(3).optional() }).optional(),
  operationId: z.string().optional(), pluginId: z.string().optional(), pluginVersion: z.string().optional(), skillId: z.string().optional(),
  sync: z.object({ documentId: z.string().regex(/^kb-[a-f0-9]{32}$/), outcome: z.enum(["created", "reused", "failed"]), error: auditOutcomeSchema.shape.errorCode.optional() }).optional(),
  policy: z.object({ policyId: z.string(), version: z.string(), effect: z.string() }).nullable().optional(),
  approval: z.object({ record: approvalSummary }).nullable().optional(), record: approvalSummary.optional(),
  entry: z.object({ id: z.string().regex(/^kb-[a-f0-9]{32}$/), status: auditOutcomeSchema.shape.status, version: z.string(), lastError: auditOutcomeSchema.shape.errorCode.optional() }).optional(),
  execution: executionEvidenceSchema.nullable().optional(),
  parallel: z.object({ tasks: z.array(z.object({ execution: executionEvidenceSchema.nullable() })).max(3) }).optional(),
  workflow: z.object({ workflowId: z.literal(ticketGuidanceWorkflow.id), steps: z.array(z.object({ execution: executionEvidenceSchema.nullable() })).max(2) }).optional(),
});

function referencesUnique(references: AuditReference[]) {
  return [...new Map(references.map((reference) => [`${reference.type}:${reference.id}:${reference.version ?? ""}`, reference])).values()].slice(0, 30);
}

export function auditOutcome(body: unknown, httpStatus: number, options: AuditOptions): AuditOutcome {
  const fallback = httpStatus === 401 || httpStatus === 403 ? "denied" : httpStatus === 404 ? "not_found" : httpStatus < 500 && httpStatus >= 400 ? "invalid_request" : httpStatus >= 500 ? "failed" : "completed";
  const minimal: AuditOutcome = { status: fallback, httpStatus, requiredPermissions: options.requiredPermissions ?? [], references: options.references ?? [], trace: [] };
  const parsed = businessSchema.safeParse(body);
  if (!parsed.success) return minimal;
  const value = parsed.data;
  const references: AuditReference[] = [...minimal.references];
  if (value.reviewRecord) references.push({ type: "security_review", id: value.reviewRecord.id, version: value.reviewRecord.policyVersion });
  const requiredPermissions = new Set<Permission>(minimal.requiredPermissions);
  const missingReasons = new Set<string>();
  const skills = [...(value.route?.skill ? [value.route.skill] : []), ...(value.route?.tasks?.map((task) => task.skill) ?? [])];
  if (value.workflow) {
    ticketGuidanceWorkflow.permissions.forEach((permission) => requiredPermissions.add(permission));
    skills.push(...ticketGuidanceWorkflow.steps.flatMap((step) => skillRegistry.filter((skill) => skill.id === step.skillId)));
  }
  for (const skill of skills) {
    references.push({ type: "skill", id: skill.id, version: skill.version });
    skill.permissions.forEach((permission) => requiredPermissions.add(permission));
    const operation = skillPluginOperation(skill.id);
    const plugin = builtinPlugins.find((entry) => entry.id === operation?.pluginId);
    if (plugin) references.push({ type: "plugin", id: plugin.id, version: plugin.version });
  }
  if (value.pluginId) references.push({ type: "plugin", id: value.pluginId, version: value.pluginVersion });
  if (value.skillId) references.push({ type: "skill", id: value.skillId });
  const policy = value.policy ?? value.approval?.record.policy ?? value.record?.policy;
  if (policy) references.push({ type: "policy", id: policy.policyId, version: policy.version });
  const approval = value.approval?.record ?? value.record;
  if (approval) references.push({ type: "approval", id: approval.id });
  const ticketId = value.execution?.ticket?.id ?? value.execution?.ticketId ?? approval?.ticket?.id;
  if (ticketId && /^ESP-\d{8}-[A-F0-9]{8}$/.test(ticketId)) references.push({ type: "ticket", id: ticketId });
  if (value.execution?.ticket?.approvalId) references.push({ type: "approval", id: value.execution.ticket.approvalId });
  if (value.entry) references.push({ type: "document", id: value.entry.id, version: value.entry.version });
  if (value.sync && value.sync.outcome !== "failed") references.push({ type: "document", id: value.sync.documentId, version: "1" });
  for (const execution of [value.execution, ...(value.parallel?.tasks.map((task) => task.execution) ?? []), ...(value.workflow?.steps.map((step) => step.execution) ?? [])]) {
    const missing = execution?.type === "knowledge_not_found" ? knowledgeMissingReasonSchema.safeParse(execution.reason) : null;
    if (missing?.success) missingReasons.add(missing.data);
    const receiptId = execution?.ticket?.id ?? execution?.ticketId;
    if (receiptId && /^ESP-\d{8}-[A-F0-9]{8}$/.test(receiptId)) references.push({ type: "ticket", id: receiptId });
    for (const citation of execution?.citations ?? []) {
      if (!/^(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32}-c\d{3})$/.test(citation.id)) continue;
      references.push({ type: "source", id: citation.id, version: citation.version });
      if (citation.id.startsWith("kb-")) references.push({ type: "document", id: citation.id.replace(/-c\d{3}$/, ""), version: citation.version });
    }
  }
  const status = value.record?.status ?? value.entry?.status ?? value.executionStatus ?? value.status ?? fallback;
  return {
    ...minimal, status, ...(value.error ?? value.entry?.lastError ?? value.sync?.error ? { errorCode: value.error ?? value.entry?.lastError ?? value.sync?.error } : {}),
    requiredPermissions: [...requiredPermissions], references: referencesUnique(references.filter((reference) => auditReferenceSchema.safeParse(reference).success)),
    trace: [...(value.trace ?? [{ step: `${options.action}.${status}`, at: new Date().toISOString() }]).slice(0, 100 - missingReasons.size),
      ...[...missingReasons].map((reason) => ({ step: `knowledge.no_evidence.${reason}`, at: new Date().toISOString() }))],
  };
}

export async function auditedResponse(request: Request, options: AuditOptions, handler: (context: AuditContext) => Promise<Response>, writer: AuditWriter = auditWriter): Promise<Response> {
  try {
    const parent = request.headers.get("x-esp-parent-audit-id");
    if (parent) {
      if (!auditIdSchema.safeParse(parent).success) throw new AuditAccessError("INVALID_AUDIT_PARENT", 400);
      const previous = await getAudit(parent, options.identity);
      if (!previous) throw new AuditAccessError("AUDIT_PARENT_NOT_FOUND", 404);
      options = { ...options, traceId: previous.start.traceId, parentId: previous.start.id };
    }
    const { value, receipt } = await runAudited(options, async (context) => {
      const response = await handler(context);
      const body: unknown = await response.json();
      return { value: { response, body }, outcome: auditOutcome(body, response.status, options) };
    }, writer);
    const headers = new Headers(value.response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-ESP-Request-ID", receipt.requestId);
    headers.set("X-ESP-Trace-ID", receipt.traceId);
    headers.set("X-ESP-Audit-Status", receipt.status);
    if (receipt.id) headers.set("X-ESP-Audit-ID", receipt.id);
    return NextResponse.json({ ...(typeof value.body === "object" && value.body !== null ? value.body : { result: value.body }), audit: receipt }, { status: value.response.status, headers });
  } catch (error) {
    if (error instanceof AuditStartError) return NextResponse.json({ error: "AUDIT_START_FAILED", requestId: error.receipt.requestId, audit: error.receipt }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof AuditAccessError) return NextResponse.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    console.error("audit.request.failed", { kind: options.kind, name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "AUDITED_REQUEST_FAILED" }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}