import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { z } from "zod";
import { ticketDetailsSchema, skillQuerySchema } from "./contracts";
import type { IdentityContext } from "./identity";
import { executeSkill } from "./executor";
import { getTicket, saveTicket, sameTicketReceipt, type TicketRecord } from "./ticket-store";
import { assertStateWritesAvailable, stateBackend } from "./state-config";
import { runAudited, auditInput, type AuditContext, type AuditWriter } from "./audit-operation";
import { auditWriter } from "./audit-store";
import { skillRegistry } from "./registry";
import { ticketApprovalPolicy } from "./approval-policy";

const confirmationSchema = z.object({
  id: z.uuid(), owner: z.string().min(1), query: skillQuerySchema, details: ticketDetailsSchema,
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), ticketId: z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/),
  skillVersion: z.string(), policyVersion: z.string(), backend: z.enum(["blob", "postgres"]),
}).strict();
type Confirmation = z.infer<typeof confirmationSchema>;
type ConfirmationStore = { read: (owner: string, id: string) => Promise<Confirmation | null>; create: (record: Confirmation) => Promise<void> };
export class TicketConfirmationError extends Error {
  constructor(public code: "CONFIRMATION_REQUIRED" | "CONFIRMATION_NOT_FOUND" | "CONFIRMATION_CONFLICT" | "CONFIRMATION_EXPIRED" | "CONFIRMATION_UNAVAILABLE", public status: number) { super(code); }
}

function blob(owner: string, id: string) {
  z.uuid().parse(id);
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new TicketConfirmationError("CONFIRMATION_UNAVAILABLE", 503);
  const prefix = createHash("sha256").update(owner).digest("hex");
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient("audit").getBlockBlobClient(`ticket-confirmations/${prefix}/${id}.json`);
}
const store: ConfirmationStore = {
  async read(owner, id) {
    try { return confirmationSchema.parse(JSON.parse((await blob(owner, id).downloadToBuffer(0, undefined, { abortSignal: AbortSignal.timeout(10_000) })).toString("utf8"))); }
    catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "BlobNotFound") return null; throw error; }
  },
  async create(record) {
    const body = JSON.stringify(confirmationSchema.parse(record));
    try { await blob(record.owner, record.id).upload(body, Buffer.byteLength(body), { conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }, abortSignal: AbortSignal.timeout(10_000) }); }
    catch (error) { if (typeof error === "object" && error !== null && "statusCode" in error && [409, 412].includes(Number(error.statusCode))) return; throw error; }
  },
};
type Dependencies = { store: ConfirmationStore; now: () => Date; writer: AuditWriter; readTicket: typeof getTicket; writeTicket: typeof saveTicket; execute: typeof executeSkill };
function subject(identity: IdentityContext) {
  if (!identity.authenticated || !identity.subject || !identity.permissions.includes("tickets.create")) throw new TicketConfirmationError("CONFIRMATION_NOT_FOUND", 403);
  return identity.subject;
}
function binding(record: Confirmation, query: string, details: z.infer<typeof ticketDetailsSchema>, owner: string) {
  if (record.owner !== owner || record.query !== query || !isDeepStrictEqual(JSON.parse(JSON.stringify(record.details)), JSON.parse(JSON.stringify(details))) || record.backend !== stateBackend() || record.skillVersion !== skillRegistry.find((skill) => skill.id === "create-it-ticket")?.version || record.policyVersion !== ticketApprovalPolicy.version || details.impact !== "individual") throw new TicketConfirmationError("CONFIRMATION_CONFLICT", 409);
}
export async function prepareTicketConfirmation(query: string, details: z.infer<typeof ticketDetailsSchema>, identity: IdentityContext, context: AuditContext, submissionId: string = randomUUID(), dependencies: Partial<Dependencies> = {}) {
  const owner = subject(identity); const storage = dependencies.store ?? store;
  const parsedDetails = ticketDetailsSchema.parse(details); const parsedQuery = skillQuerySchema.parse(query);
  const now = dependencies.now?.() ?? new Date();
  const result = await runAudited({ identity, kind: "skill_request", action: "ticket.confirmation", mutation: true, traceId: context.traceId, requiredPermissions: ["tickets.create"], input: auditInput({ query: parsedQuery, parameters: parsedDetails }) }, async () => {
    assertStateWritesAvailable();
    const record: Confirmation = { id: z.uuid().parse(submissionId), owner, query: parsedQuery, details: parsedDetails, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), ticketId: `ESP-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${createHash("sha256").update(`${owner}:${submissionId}`).digest("hex").slice(0, 8).toUpperCase()}`, backend: stateBackend(), skillVersion: skillRegistry.find((skill) => skill.id === "create-it-ticket")!.version, policyVersion: ticketApprovalPolicy.version };
    binding(record, parsedQuery, parsedDetails, owner);
    await storage.create(record);
    const saved = await storage.read(owner, submissionId);
    if (!saved || saved.id !== submissionId) throw new TicketConfirmationError("CONFIRMATION_UNAVAILABLE", 503);
    binding(saved, parsedQuery, parsedDetails, owner);
    if (Date.parse(saved.expiresAt) <= now.getTime()) throw new TicketConfirmationError("CONFIRMATION_EXPIRED", 409);
    return { value: { id: saved.id, expiresAt: saved.expiresAt, ticketId: saved.ticketId }, outcome: { status: "waiting_confirmation" as const, httpStatus: 200, requiredPermissions: ["tickets.create" as const], references: [], trace: [] } };
  }, dependencies.writer ?? auditWriter);
  return result.value;
}

export async function executeConfirmedTicket(id: string | undefined, query: string, details: z.infer<typeof ticketDetailsSchema>, identity: IdentityContext, dependencies: Partial<Dependencies> = {}) {
  const owner = subject(identity);
  if (!id || !z.uuid().safeParse(id).success) throw new TicketConfirmationError("CONFIRMATION_REQUIRED", 409);
  const record = await (dependencies.store ?? store).read(owner, id);
  if (!record || record.id !== id) throw new TicketConfirmationError("CONFIRMATION_NOT_FOUND", 404);
  binding(record, skillQuerySchema.parse(query), ticketDetailsSchema.parse(details), owner);
  const expected: TicketRecord = { id: record.ticketId, status: "open", summary: record.details.description, createdAt: record.createdAt, createdBy: owner, details: record.details };
  const existing = await (dependencies.readTicket ?? getTicket)(record.ticketId, owner);
  if (existing) {
    if (!sameTicketReceipt(existing, expected)) throw new TicketConfirmationError("CONFIRMATION_CONFLICT", 409);
    return { execution: { type: "ticket_created" as const, ticket: existing }, receiptReused: true };
  }
  if (Date.parse(record.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) throw new TicketConfirmationError("CONFIRMATION_EXPIRED", 409);
  assertStateWritesAvailable();
  const execution = await (dependencies.execute ?? executeSkill)("create-it-ticket", record.query, owner, { ticketMetadata: { id: record.ticketId, createdAt: record.createdAt }, writeTicket: dependencies.writeTicket ?? saveTicket }, record.details);
  if (execution.type !== "ticket_created" || !sameTicketReceipt(execution.ticket, expected)) throw new TicketConfirmationError("CONFIRMATION_CONFLICT", 409);
  return { execution, receiptReused: false };
}