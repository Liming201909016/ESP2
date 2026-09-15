import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { createHash } from "node:crypto";
import { text as readStreamText } from "node:stream/consumers";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AuditAccessError, auditIdSchema, auditResultSchema, auditStartSchema, type AuditDetail, type AuditResult, type AuditStart } from "./audit-contracts";
import type { IdentityContext } from "./identity";
import type { AuditWriter } from "./audit-operation";

function containerClient() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error("AZURE_STORAGE_ACCOUNT is not configured");
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient("audit");
}

function ownerPrefix(subject: string) { return `execution-audit/${createHash("sha256").update(subject).digest("hex")}/`; }
function recordPath(subject: string, id: string, part: "starts" | "results") { return `${ownerPrefix(subject)}${part}/${auditIdSchema.parse(id)}.json`; }
function errorCode(error: unknown) { return typeof error === "object" && error !== null && "code" in error ? error.code : undefined; }

async function readJson(path: string): Promise<unknown | null> {
  try {
    const response = await containerClient().getBlobClient(path).download(0, undefined, { abortSignal: AbortSignal.timeout(5_000) });
    if (!response.readableStreamBody) throw new Error("Audit response has no body");
    return JSON.parse(await readStreamText(response.readableStreamBody));
  } catch (error) { if (errorCode(error) === "BlobNotFound") return null; throw error; }
}

async function createJson(path: string, record: AuditStart | AuditResult) {
  const body = JSON.stringify(record);
  try {
    await containerClient().getBlockBlobClient(path).upload(body, Buffer.byteLength(body), {
      conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }, abortSignal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const code = errorCode(error);
    if (code !== "BlobAlreadyExists" && code !== "ConditionNotMet" && !(typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 412)) throw error;
    const existing = await readJson(path);
    if (!isDeepStrictEqual(existing, JSON.parse(body))) throw new Error("Audit record already exists with different content");
  }
}

export const auditWriter: AuditWriter = {
  begin: async (input) => { const record = auditStartSchema.parse(input); await createJson(recordPath(record.actor.subject, record.id, "starts"), record); },
  finish: async (input, subject) => { const record = auditResultSchema.parse(input); await createJson(recordPath(subject, record.id, "results"), record); },
};

export function auditIdentity(identity: IdentityContext) {
  if (!identity.authenticated) throw new AuditAccessError("AUTHENTICATION_REQUIRED", 401);
  if (!identity.subject || !identity.permissions.length) throw new AuditAccessError("PERMISSION_REQUIRED", 403);
  return identity.subject;
}

export async function getAudit(id: string, identity: IdentityContext): Promise<AuditDetail | null> {
  const subject = auditIdentity(identity);
  if (!auditIdSchema.safeParse(id).success) return null;
  const rawStart = await readJson(recordPath(subject, id, "starts"));
  if (rawStart === null) return null;
  const parsedStart = auditStartSchema.safeParse(rawStart);
  if (!parsedStart.success || parsedStart.data.id !== id || parsedStart.data.actor.subject !== subject) throw new Error("Invalid stored audit start");
  const start = parsedStart.data;
  if (!start.requiredPermissions.every((permission) => identity.permissions.includes(permission))) return null;
  const rawResult = await readJson(recordPath(subject, id, "results"));
  if (rawResult === null) return { start, result: null };
  const parsedResult = auditResultSchema.safeParse(rawResult);
  if (!parsedResult.success || parsedResult.data.id !== id || parsedResult.data.requestId !== start.requestId || parsedResult.data.traceId !== start.traceId || Date.parse(parsedResult.data.completedAt) < Date.parse(start.startedAt)) throw new Error("Invalid stored audit result");
  if (!parsedResult.data.requiredPermissions.every((permission) => identity.permissions.includes(permission))) return null;
  return { start, result: parsedResult.data };
}

export const auditQuerySchema = z.object({
  cursor: z.string().max(4_000).optional(), traceId: z.uuid().optional(),
  reference: z.string().regex(/^(?:approval:apr-[a-f0-9]{32}|ticket:ESP-\d{8}-[A-F0-9]{8}|document:kb-[a-f0-9]{32}|source:(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32}-c\d{3})|connector:blob-knowledge|connector_source:[a-z0-9][a-z0-9-]{2,63}|security_review:sr-[a-f0-9]{32})$/).optional(),
});

export async function listAudit(identity: IdentityContext, input: z.infer<typeof auditQuerySchema> = {}) {
  const subject = auditIdentity(identity);
  const query = auditQuerySchema.parse(input);
  const prefix = `${ownerPrefix(subject)}starts/`;
  const pages = containerClient().listBlobsFlat({ prefix, abortSignal: AbortSignal.timeout(10_000) }).byPage({ continuationToken: query.cursor, maxPageSize: 20 });
  const page = await pages.next();
  if (page.done) return { records: [], nextCursor: null };
  const records: AuditDetail[] = [];
  for (const item of page.value.segment.blobItems) {
    const id = item.name.startsWith(prefix) ? item.name.slice(prefix.length).replace(/\.json$/, "") : "";
    if (!auditIdSchema.safeParse(id).success) continue;
    const record = await getAudit(id, identity);
    if (!record || (query.traceId && record.start.traceId !== query.traceId)) continue;
    if (query.reference && ![...record.start.references, ...(record.result?.references ?? [])].some((reference) => `${reference.type}:${reference.id}` === query.reference)) continue;
    records.push(record);
  }
  return { records, nextCursor: page.value.continuationToken || null };
}