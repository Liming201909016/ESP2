import { z } from "zod";
import { permissionSchema, ticketImpactSchema } from "./contracts";

export const auditIdSchema = z.string().regex(/^aud-\d{13}-[a-f0-9]{32}$/);
export const auditKindSchema = z.enum(["skill_request", "plugin_trial", "approval_action", "knowledge_change", "ticket_read", "connector_sync"]);
export const auditInputSchema = z.object({
  queryLength: z.number().int().nonnegative().optional(), queryHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  contentLength: z.number().int().nonnegative().optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  fields: z.array(z.enum(["description", "device", "impact", "ticketId"])).max(4).default([]),
  impact: ticketImpactSchema.optional(), confirmed: z.boolean().optional(),
}).strict();
export const auditReferenceSchema = z.object({
  type: z.enum(["skill", "plugin", "approval", "ticket", "document", "source", "policy", "connector", "connector_source", "security_review"]),
  id: z.string().min(1).max(160), version: z.string().max(80).optional(),
}).strict();
export const auditStartSchema = z.object({
  schemaVersion: z.literal(1), id: auditIdSchema, requestId: z.uuid(), traceId: z.uuid(),
  parentId: auditIdSchema.optional(),
  kind: auditKindSchema, action: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  actor: z.object({ subject: z.string().min(1).max(300), source: z.enum(["development", "entra"]), permissions: z.array(permissionSchema) }).strict(),
  startedAt: z.iso.datetime(), mutation: z.boolean(), input: auditInputSchema,
  requiredPermissions: z.array(permissionSchema), references: z.array(auditReferenceSchema).max(30),
}).strict();
export const auditOutcomeSchema = z.object({
  status: z.enum(["completed", "partial", "no_result", "waiting_confirmation", "waiting_approval", "needs_input", "not_found", "no_evidence", "not_routed", "unavailable", "failed", "denied", "invalid_request", "pending", "approved", "rejected", "cancelled", "expired", "executing", "execution_unknown", "draft", "published", "inactive", "indexing", "error"]),
  httpStatus: z.number().int().min(100).max(599), errorCode: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(),
  requiredPermissions: z.array(permissionSchema), references: z.array(auditReferenceSchema).max(30),
  trace: z.array(z.object({ step: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/), at: z.iso.datetime() }).strict()).max(100),
}).strict();
export const auditResultSchema = auditOutcomeSchema.extend({
  schemaVersion: z.literal(1), id: auditIdSchema, requestId: z.uuid(), traceId: z.uuid(),
  completedAt: z.iso.datetime(), durationMs: z.number().nonnegative(),
}).strict();
export const auditReceiptSchema = z.object({
  id: auditIdSchema.nullable(), requestId: z.uuid(), traceId: z.uuid(), status: z.enum(["recorded", "incomplete", "unavailable", "not_recorded"]),
});
export const auditDetailSchema = z.object({ start: auditStartSchema, result: auditResultSchema.nullable() });
export const auditListSchema = z.object({ records: z.array(auditDetailSchema), nextCursor: z.string().nullable() });

export type AuditStart = z.infer<typeof auditStartSchema>;
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;
export type AuditResult = z.infer<typeof auditResultSchema>;
export type AuditReceipt = z.infer<typeof auditReceiptSchema>;
export type AuditDetail = z.infer<typeof auditDetailSchema>;
export type AuditList = z.infer<typeof auditListSchema>;
export type AuditReference = z.infer<typeof auditReferenceSchema>;

export class AuditAccessError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export class AuditStartError extends Error {
  constructor(public receipt: AuditReceipt) { super("AUDIT_START_FAILED"); }
}