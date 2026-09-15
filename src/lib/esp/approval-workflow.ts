import { createHash } from "node:crypto";
import { z } from "zod";
import { ApprovalError, approvalActionSchema, approvalDetailSchema, approvalSummarySchema, type ApprovalAction, type ApprovalRecord, type StoredApproval } from "./approval-contracts";
import { evaluateTicketPolicy, ticketApprovalPolicy } from "./approval-policy";
import { getApproval, writeApproval } from "./approval-store";
import { skillQuerySchema, ticketDetailsSchema, type TicketDetails } from "./contracts";
import { executeSkill } from "./executor";
import type { IdentityContext } from "./identity";
import { getTicket, sameTicketReceipt, saveApprovedTicket, type TicketRecord } from "./ticket-store";
import { inPostgresTransaction } from "./postgres";
import { assertStateWritesAvailable, stateBackend } from "./state-config";

export const approvalExecutionLeaseMs = 120_000;
export type ApprovalDependencies = {
  get: (id: string) => Promise<StoredApproval | null>;
  write: (record: ApprovalRecord, etag: string | null) => Promise<StoredApproval>;
  readTicket: typeof getTicket;
  execute: (record: ApprovalRecord) => Promise<TicketRecord>;
  now: () => string;
};

export function canReviewApprovals(identity: IdentityContext) {
  return identity.authenticated && Boolean(identity.subject) && identity.source === "development" && identity.permissions.includes("tickets.create") &&
    process.env.ESP_ENVIRONMENT === "dev" && process.env.ESP_DEV_AUTH_BYPASS === "true";
}

export function requireApprovalIdentity(identity: IdentityContext, write = false) {
  if (!identity.authenticated) throw new ApprovalError("AUTHENTICATION_REQUIRED", 401);
  if (!identity.subject || !(identity.permissions.includes("tickets.create") || (!write && identity.permissions.includes("tickets.read")))) throw new ApprovalError("PERMISSION_REQUIRED", 403);
  return identity.subject;
}

function requestHash(query: string, parameters: TicketDetails, policy: ApprovalRecord["policy"]) {
  return createHash("sha256").update(JSON.stringify({ query, parameters, policy })).digest("hex");
}

export function plannedApprovalTicket(record: ApprovalRecord): TicketRecord {
  if (!record.execution) throw new ApprovalError("EXECUTION_NOT_STARTED", 409);
  return {
    id: record.execution.ticketId, createdAt: record.execution.createdAt, createdBy: record.createdBy, status: "open",
    summary: record.parameters.description, details: record.parameters, approvalId: record.id,
  };
}

const defaults: ApprovalDependencies = {
  get: getApproval, write: writeApproval, readTicket: getTicket, now: () => new Date().toISOString(),
  execute: async (record) => {
    const ticket = plannedApprovalTicket(record);
    const result = await executeSkill(record.skillId, record.query, record.createdBy, {
      writeTicket: saveApprovedTicket, ticketMetadata: { id: ticket.id, createdAt: ticket.createdAt, approvalId: record.id },
    }, record.parameters);
    if (result.type !== "ticket_created") throw new Error("Approval execution did not return a ticket");
    return result.ticket;
  },
};

export function effectiveApproval(record: ApprovalRecord, now = new Date().toISOString()): ApprovalRecord {
  return ["pending", "approved"].includes(record.status) && Date.parse(now) >= Date.parse(record.expiresAt) ? { ...record, status: "expired" } : record;
}

export function approvalDetails(stored: StoredApproval, identity: IdentityContext, now = new Date().toISOString()) {
  const record = effectiveApproval(stored.record, now);
  const actions: ApprovalAction["action"][] = [];
  if (identity.subject === record.createdBy && identity.permissions.includes("tickets.create")) {
    if (record.status === "pending") { if (canReviewApprovals(identity)) actions.push("approve", "reject"); actions.push("cancel"); }
    if (record.status === "approved") actions.push("execute", "cancel");
    if (record.status === "execution_unknown") {
      actions.push("reconcile");
      if (Date.parse(now) < Date.parse(record.expiresAt) && (record.execution?.attempts ?? 3) < 3) actions.push("execute");
    }
    if (record.status === "executing" && Date.parse(now) - Date.parse(record.updatedAt) >= approvalExecutionLeaseMs) actions.push("reconcile");
  }
  return approvalDetailSchema.parse({ ...stored, record, actions, canReview: canReviewApprovals(identity) });
}

export function approvalSummary(record: ApprovalRecord, now = new Date().toISOString()) {
  return approvalSummarySchema.parse({ ...effectiveApproval(record, now), description: record.parameters.description, impact: record.parameters.impact, ticketId: record.ticket?.id });
}

export async function submitApproval(query: string, parameters: TicketDetails, submissionId: string, identity: IdentityContext, overrides: Partial<ApprovalDependencies> = {}): Promise<StoredApproval> {
  const createdBy = requireApprovalIdentity(identity, true);
  assertStateWritesAvailable();
  if (!canReviewApprovals(identity)) throw new ApprovalError("DEV_REVIEW_REQUIRED", 403);
  const dependencies = { ...defaults, ...overrides };
  const normalizedQuery = skillQuerySchema.parse(query);
  const details = ticketDetailsSchema.parse(parameters);
  const policy = evaluateTicketPolicy(details);
  if (!policy || policy.effect !== "approval") throw new ApprovalError("APPROVAL_NOT_REQUIRED", 400);
  const snapshot: ApprovalRecord["policy"] = { ...policy, effect: "approval" };
  const id = `apr-${createHash("sha256").update(JSON.stringify([createdBy, z.uuid().parse(submissionId)])).digest("hex").slice(0, 32)}`;
  const hash = requestHash(normalizedQuery, details, snapshot);
  function existingRecord(existing: StoredApproval) {
    if (existing.record.createdBy !== createdBy || existing.record.requestHash !== hash) throw new ApprovalError("SUBMISSION_CONFLICT", 409);
    return existing;
  }
  const existing = await dependencies.get(id);
  if (existing) return existingRecord(existing);
  const now = dependencies.now();
  const record: ApprovalRecord = {
    id, skillId: "create-it-ticket", createdBy, query: normalizedQuery, parameters: details, policy: snapshot, requestHash: hash,
    status: "pending", createdAt: now, updatedAt: now, expiresAt: new Date(Date.parse(now) + ticketApprovalPolicy.expiresInHours * 3_600_000).toISOString(),
    events: [{ action: "submitted", actor: createdBy, at: now }],
  };
  try { return await dependencies.write(record, null); }
  catch (error) {
    if (!(error instanceof ApprovalError) || error.code !== "CONFLICT") throw error;
    const raced = await dependencies.get(id);
    if (!raced) throw error;
    return existingRecord(raced);
  }
}

export async function changeApproval(id: string, input: ApprovalAction, identity: IdentityContext, overrides: Partial<ApprovalDependencies> = {}): Promise<StoredApproval> {
  assertStateWritesAvailable();
  const transactional = stateBackend() === "postgres" && (input.action === "execute" || input.action === "reconcile");
  return transactional
    ? inPostgresTransaction(() => changeApprovalState(id, input, identity, overrides, true))
    : changeApprovalState(id, input, identity, overrides, false);
}

async function changeApprovalState(id: string, input: ApprovalAction, identity: IdentityContext, overrides: Partial<ApprovalDependencies>, transactional: boolean): Promise<StoredApproval> {
  const actor = requireApprovalIdentity(identity, true);
  const action = approvalActionSchema.parse(input);
  const dependencies = { ...defaults, ...overrides };
  const stored = await dependencies.get(id);
  if (!stored || stored.record.createdBy !== actor) throw new ApprovalError("NOT_FOUND", 404);
  const record = stored.record;
  if (action.action === "execute" && record.status === "completed") return stored;
  if (stored.etag !== action.etag) throw new ApprovalError("CONFLICT", 409);
  const now = dependencies.now();
  const expired = Date.parse(now) >= Date.parse(record.expiresAt);
  if (expired && ["pending", "approved"].includes(record.status)) {
    await dependencies.write({ ...record, status: "expired", updatedAt: now, events: [...record.events, { action: "expired", actor, at: now }] }, stored.etag);
    throw new ApprovalError("APPROVAL_EXPIRED", 409);
  }
  if (record.requestHash !== requestHash(record.query, record.parameters, record.policy)) throw new ApprovalError("APPROVAL_INPUT_CHANGED", 409);
  const policy = evaluateTicketPolicy(record.parameters);
  if ((action.action === "approve" || action.action === "execute") && (!policy || policy.effect !== "approval" || policy.policyId !== record.policy.policyId || policy.version !== record.policy.version || policy.ruleId !== record.policy.ruleId)) throw new ApprovalError("POLICY_CHANGED", 409);
  const allowed = approvalDetails(stored, identity, now).actions;
  if (!allowed.includes(action.action)) {
    if ((action.action === "approve" || action.action === "reject") && !canReviewApprovals(identity)) throw new ApprovalError("DEV_REVIEW_REQUIRED", 403);
    throw new ApprovalError(record.status === "executing" ? "EXECUTION_BUSY" : "INVALID_TRANSITION", 409);
  }

  if (action.action === "approve" || action.action === "reject" || action.action === "cancel") {
    const status = action.action === "approve" ? "approved" : action.action === "reject" ? "rejected" : "cancelled";
    return dependencies.write({ ...record, status, updatedAt: now, events: [...record.events, { action: status, actor, at: now, ...(action.reason ? { reason: action.reason } : {}) }] }, stored.etag);
  }

  if (action.action === "reconcile") {
    const expected = plannedApprovalTicket(record);
    const ticket = await dependencies.readTicket(expected.id, actor);
    if (ticket && !sameTicketReceipt(ticket, expected)) throw new ApprovalError("APPROVAL_TICKET_CONFLICT", 409);
    if (ticket) return dependencies.write({ ...record, status: "completed", ticket, failureCode: undefined, updatedAt: now, events: [...record.events, { action: "execution_reconciled", actor, at: now }] }, stored.etag);
    if (record.status === "execution_unknown") return stored;
    return dependencies.write({ ...record, status: "execution_unknown", failureCode: "EXECUTION_UNCERTAIN", updatedAt: now, events: [...record.events, { action: "execution_uncertain", actor, at: now }] }, stored.etag);
  }

  const execution = record.execution ? { ...record.execution, attempts: record.execution.attempts + 1 } : {
    ticketId: `ESP-${now.slice(0, 10).replaceAll("-", "")}-${record.id.slice(4, 12).toUpperCase()}`, createdAt: now, attempts: 1,
  };
  const locked = await dependencies.write({ ...record, status: "executing", execution, failureCode: undefined, updatedAt: now, events: [...record.events, { action: "execution_started", actor, at: now }] }, stored.etag);
  let ticket: TicketRecord;
  try {
    ticket = await dependencies.execute(locked.record);
    if (!sameTicketReceipt(ticket, plannedApprovalTicket(locked.record))) throw new Error("Approval ticket receipt does not match the approved input");
  } catch (error) {
    if (transactional) throw error;
    const failedAt = dependencies.now();
    return dependencies.write({ ...locked.record, status: "execution_unknown", failureCode: "EXECUTION_UNCERTAIN", updatedAt: failedAt, events: [...locked.record.events, { action: "execution_uncertain", actor, at: failedAt }] }, locked.etag);
  }
  const completedAt = dependencies.now();
  return dependencies.write({ ...locked.record, status: "completed", ticket, updatedAt: completedAt, events: [...locked.record.events, { action: "execution_completed", actor, at: completedAt }] }, locked.etag);
}