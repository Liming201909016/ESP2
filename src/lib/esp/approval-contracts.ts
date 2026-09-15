import { z } from "zod";
import { skillQuerySchema, ticketDetailsSchema, ticketImpactSchema, ticketReceiptSchema } from "./contracts";
import { auditReceiptSchema } from "./audit-contracts";

export const approvalIdSchema = z.string().regex(/^apr-[a-f0-9]{32}$/);
export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled", "expired", "executing", "completed", "execution_unknown"]);
export const approvalActionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel", "execute", "reconcile"]),
  etag: z.string().min(1).max(200), reason: z.string().trim().max(500).optional(),
}).strict().refine((input) => input.action !== "reject" || (input.reason?.length ?? 0) >= 3, { message: "Rejection requires a reason of at least 3 characters", path: ["reason"] });

export const approvalRecordSchema = z.object({
  id: approvalIdSchema, skillId: z.literal("create-it-ticket"), createdBy: z.string().min(1),
  query: skillQuerySchema, parameters: ticketDetailsSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  policy: z.object({ policyId: z.string(), version: z.string(), ruleId: z.string(), effect: z.literal("approval"), reason: z.string() }),
  status: approvalStatusSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  execution: z.object({ ticketId: z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/), createdAt: z.iso.datetime(), attempts: z.number().int().min(1).max(3) }).optional(),
  ticket: ticketReceiptSchema.optional(), failureCode: z.literal("EXECUTION_UNCERTAIN").optional(),
  events: z.array(z.object({
    action: z.enum(["submitted", "approved", "rejected", "cancelled", "expired", "execution_started", "execution_completed", "execution_uncertain", "execution_reconciled"]),
    actor: z.string().min(1), at: z.iso.datetime(), reason: z.string().max(500).optional(),
  })).min(1).max(40),
}).strict().superRefine((record, context) => {
  if (record.parameters.impact === "individual") context.addIssue({ code: "custom", message: "Approval input must require review" });
  if (["executing", "execution_unknown", "completed"].includes(record.status) && !record.execution) context.addIssue({ code: "custom", message: "Execution state requires a stable ticket identity" });
  if (record.status === "completed" && (!record.ticket || record.ticket.id !== record.execution?.ticketId || record.ticket.approvalId !== record.id || record.ticket.createdBy !== record.createdBy)) context.addIssue({ code: "custom", message: "Completed approval must contain its own ticket receipt" });
});

export const approvalStoredSchema = z.object({ record: approvalRecordSchema, etag: z.string().min(1) });
export const approvalDetailSchema = approvalStoredSchema.extend({ actions: z.array(approvalActionSchema.shape.action), canReview: z.boolean(), audit: auditReceiptSchema.optional() });
export const approvalSummarySchema = z.object(approvalRecordSchema.shape).pick({ id: true, status: true, createdBy: true, createdAt: true, updatedAt: true, expiresAt: true, policy: true }).extend({
  description: z.string(), impact: z.enum(["team", "organization"]), ticketId: z.string().optional(),
});
export const approvalListSchema = z.object({ approvals: z.array(approvalSummarySchema), nextCursor: z.string().nullable(), canReview: z.boolean() });
export const policiesResponseSchema = z.object({
  policies: z.array(z.object({
    id: z.string(), version: z.string(), name: z.string(), mode: z.literal("dev-simulation"), skillId: z.literal("create-it-ticket"), expiresInHours: z.number(),
    rules: z.array(z.object({ id: z.string(), impact: ticketImpactSchema, effect: z.enum(["confirmation", "approval"]), reason: z.string() })),
  })), canReview: z.boolean(),
});

export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
export type StoredApproval = z.infer<typeof approvalStoredSchema>;
export type ApprovalDetail = z.infer<typeof approvalDetailSchema>;
export type ApprovalList = z.infer<typeof approvalListSchema>;
export type ApprovalAction = z.infer<typeof approvalActionSchema>;
export type PoliciesResponse = z.infer<typeof policiesResponseSchema>;

export class ApprovalError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}