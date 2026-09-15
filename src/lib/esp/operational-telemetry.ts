import { z } from "zod";
import { auditKindSchema, auditOutcomeSchema, auditReceiptSchema, auditStartSchema } from "./audit-contracts";

export const operationEventSchema = z.object({
  event: z.literal("esp.operation"), schemaVersion: z.literal(1), service: z.literal("esp-platform"),
  at: z.iso.datetime(), requestId: z.uuid(), traceId: z.uuid(), kind: auditKindSchema,
  action: auditStartSchema.shape.action, outcome: auditOutcomeSchema.shape.status,
  httpStatus: auditOutcomeSchema.shape.httpStatus, errorCode: auditOutcomeSchema.shape.errorCode,
  durationMs: z.number().finite().nonnegative(), mutation: z.boolean(), invoked: z.boolean(),
  auditStatus: auditReceiptSchema.shape.status,
}).strict();

export type OperationEvent = z.infer<typeof operationEventSchema>;

export function emitOperationEvent(event: OperationEvent) {
  try {
    const parsed = operationEventSchema.safeParse(event);
    if (parsed.success) console.info(JSON.stringify(parsed.data));
  } catch {}
}