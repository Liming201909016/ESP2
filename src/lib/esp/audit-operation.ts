import { createHash, randomUUID } from "node:crypto";
import { AuditStartError, auditInputSchema, auditResultSchema, auditStartSchema, type AuditOutcome, type AuditReceipt, type AuditResult, type AuditStart } from "./audit-contracts";
import type { IdentityContext } from "./identity";
import { emitOperationEvent } from "./operational-telemetry";

export type AuditWriter = { begin: (record: AuditStart) => Promise<void>; finish: (record: AuditResult, subject: string) => Promise<void> };
export type AuditOptions = {
  identity: IdentityContext; kind: AuditStart["kind"]; action: string; mutation: boolean;
  requestId?: string; traceId?: string; input?: AuditStart["input"];
  parentId?: string;
  requiredPermissions?: AuditStart["requiredPermissions"]; references?: AuditStart["references"];
};
export type AuditContext = Pick<AuditStart, "id" | "requestId" | "traceId">;

export function auditInput(value: { query?: string; content?: string; parameters?: Record<string, unknown>; confirmed?: boolean }) {
  const parameters = value.parameters ?? {};
  return auditInputSchema.parse({
    ...(value.query === undefined ? {} : { queryLength: value.query.length, queryHash: createHash("sha256").update(value.query).digest("hex") }),
    ...(value.content === undefined ? {} : { contentLength: value.content.length, contentHash: createHash("sha256").update(value.content).digest("hex") }),
    fields: ["description", "device", "impact", "ticketId"].filter((field) => parameters[field] !== undefined),
    ...(["individual", "team", "organization"].includes(String(parameters.impact)) ? { impact: parameters.impact } : {}),
    ...(value.confirmed === undefined ? {} : { confirmed: value.confirmed }),
  });
}

export async function runAudited<T>(options: AuditOptions, work: (context: AuditContext) => Promise<{ value: T; outcome: AuditOutcome }>, writer: AuditWriter) {
  const requestId = options.requestId ?? randomUUID();
  const traceId = options.traceId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const id = `aud-${String(9_999_999_999_999 - Date.parse(startedAt)).padStart(13, "0")}-${requestId.replaceAll("-", "")}`;
  const context = { id, requestId, traceId };
  const eligible = options.identity.authenticated && Boolean(options.identity.subject) && options.identity.source !== "none";
  const receipt: AuditReceipt = { id: eligible ? id : null, requestId, traceId, status: eligible ? "unavailable" : "not_recorded" };
  function observe(outcome: Pick<AuditOutcome, "status" | "httpStatus" | "errorCode">, invoked: boolean) {
    emitOperationEvent({
      event: "esp.operation", schemaVersion: 1, service: "esp-platform", at: new Date().toISOString(), requestId, traceId,
      kind: options.kind, action: options.action, outcome: outcome.status, httpStatus: outcome.httpStatus, errorCode: outcome.errorCode,
      durationMs: Math.round(performance.now() - started), mutation: options.mutation, invoked, auditStatus: receipt.status,
    });
  }
  let begun = false;
  if (eligible) {
    const start = auditStartSchema.parse({
      schemaVersion: 1, ...context, kind: options.kind, action: options.action, startedAt, mutation: options.mutation,
      ...(options.parentId ? { parentId: options.parentId } : {}),
      actor: { subject: options.identity.subject, source: options.identity.source, permissions: options.identity.permissions },
      input: options.input ?? { fields: [] }, requiredPermissions: options.requiredPermissions ?? [], references: options.references ?? [],
    });
    try { await writer.begin(start); begun = true; receipt.status = "incomplete"; }
    catch { console.error("audit.begin.failed", { requestId, kind: options.kind }); }
  }
  if (options.mutation && !begun) {
    observe({ status: "unavailable", httpStatus: 503, errorCode: "AUDIT_START_FAILED" }, false);
    throw new AuditStartError(receipt);
  }

  async function finish(outcome: AuditOutcome) {
    if (!begun) return;
    try {
      await writer.finish(auditResultSchema.parse({ ...outcome, schemaVersion: 1, ...context, completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started) }), options.identity.subject!);
      receipt.status = "recorded";
    } catch { console.error("audit.finish.failed", { requestId, kind: options.kind }); }
  }

  try {
    const { value, outcome } = await work(context);
    await finish(outcome);
    observe(outcome, true);
    return { value, receipt };
  } catch (error) {
    await finish({ status: "failed", httpStatus: 500, errorCode: "UNHANDLED_OPERATION_FAILED", requiredPermissions: options.requiredPermissions ?? [], references: options.references ?? [], trace: [] });
    observe({ status: "failed", httpStatus: 500, errorCode: "UNHANDLED_OPERATION_FAILED" }, true);
    throw error;
  }
}