import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { text } from "node:stream/consumers";
import { z } from "zod";
import { assessReview, checkReviewControls, readReviewEvidence, reviewCapabilities, reviewIdSchema, securityReviewSchema, SecurityReviewError, type SecurityReview, type StoredSecurityReview } from "./security-review";
import { assertStateWritesAvailable } from "./state-config";
import type { AuditWriter } from "./audit-operation";
import type { AuditDetail } from "./audit-contracts";
import { auditWriter } from "./audit-store";

export interface SecurityReviewStore {
  get(owner: string, id: string): Promise<StoredSecurityReview | null>;
  put(record: SecurityReview, etag: string | null): Promise<StoredSecurityReview>;
  list(owner: string, cursor?: string): Promise<{ records: StoredSecurityReview[]; nextCursor: string | null }>;
}
export function validateSecurityReview(value: unknown) {
  const record = securityReviewSchema.parse(value);
  const evidence = readReviewEvidence(record.caseId); const findings = checkReviewControls(evidence);
  if (!isDeepStrictEqual(record.evidence, evidence) || !isDeepStrictEqual(record.findings, findings) || !isDeepStrictEqual(record.evaluation, assessReview(findings))) throw new Error("INVALID_REVIEW_EVIDENCE");
  if (!isDeepStrictEqual(record.stages, reviewCapabilities.slice(0, 4).map((skill) => ({ skillId: skill.id, version: skill.version, operationId: skill.operationId, status: "completed" })))) throw new Error("INVALID_REVIEW_STAGES");
  if (record.history[0].action !== "submitted" || record.history[0].actor !== record.createdBy || record.history[0].at !== record.createdAt) throw new Error("INVALID_REVIEW_HISTORY");
  if (record.status === "awaiting_decision" ? record.history.length !== 1 : record.history.length !== 2 || record.history[1].action !== record.status || record.history[1].actor !== record.createdBy || Date.parse(record.history[1].at) < Date.parse(record.createdAt)) throw new Error("INVALID_REVIEW_HISTORY");
  if (record.status === "approved" && !record.evaluation.controlsPassed) throw new Error("INVALID_REVIEW_DECISION");
  return record;
}
function prefix(owner: string) { return `security-reviews/${createHash("sha256").update(owner).digest("hex")}/`; }
function container() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error("REVIEW_STORAGE_NOT_CONFIGURED");
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient("audit");
}
const blobStore: SecurityReviewStore = {
  async get(owner, id) {
    reviewIdSchema.parse(id);
    try {
      const response = await container().getBlobClient(`${prefix(owner)}${id}.json`).download(0, undefined, { abortSignal: AbortSignal.timeout(10_000) });
      if (!response.readableStreamBody || !response.etag) throw new Error("REVIEW_READ_INCOMPLETE");
      const record = validateSecurityReview(JSON.parse(await text(response.readableStreamBody)));
      if (record.createdBy !== owner || record.id !== id) throw new Error("REVIEW_OWNER_MISMATCH");
      return { record, etag: response.etag };
    } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "BlobNotFound") return null; throw error; }
  },
  async put(record, etag) {
    assertStateWritesAvailable(); const parsed = validateSecurityReview(record); const body = JSON.stringify(parsed);
    try {
      const response = await container().getBlockBlobClient(`${prefix(parsed.createdBy)}${parsed.id}.json`).upload(body, Buffer.byteLength(body), { conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }, abortSignal: AbortSignal.timeout(10_000) });
      if (!response.etag) throw new Error("REVIEW_WRITE_UNKNOWN");
      return { record: parsed, etag: response.etag };
    } catch (error) {
      if (typeof error === "object" && error !== null && "statusCode" in error && [409, 412].includes(Number(error.statusCode))) throw new SecurityReviewError("REVIEW_CONFLICT", 409);
      throw error;
    }
  },
  async list(owner, cursor) {
    if (cursor) z.string().max(4000).parse(cursor);
    const page = await container().listBlobsFlat({ prefix: prefix(owner), abortSignal: AbortSignal.timeout(10_000) }).byPage({ maxPageSize: 20, continuationToken: cursor }).next();
    if (page.done) return { records: [], nextCursor: null };
    const records: StoredSecurityReview[] = [];
    for (const item of page.value.segment.blobItems) {
      const id = item.name.slice(prefix(owner).length).replace(/\.json$/, "");
      if (!reviewIdSchema.safeParse(id).success) continue;
      const record = await blobStore.get(owner, id); if (record) records.push(record);
    }
    return { records, nextCursor: page.value.continuationToken || null };
  },
};
export function createMemorySecurityReviewStore(): SecurityReviewStore {
  const records = new Map<string, StoredSecurityReview>();
  return {
    async get(owner, id) { return structuredClone(records.get(`${owner}/${id}`) ?? null); },
    async put(record, etag) {
      assertStateWritesAvailable(); const parsed = validateSecurityReview(record); const key = `${record.createdBy}/${record.id}`; const previous = records.get(key);
      if (previous ? previous.etag !== etag : etag !== null) throw new SecurityReviewError("REVIEW_CONFLICT", 409);
      const saved = { record: parsed, etag: String(Number(previous?.etag ?? 0) + 1) }; records.set(key, structuredClone(saved)); return structuredClone(saved);
    },
    async list(owner) { return { records: [...records.values()].filter((entry) => entry.record.createdBy === owner).map((entry) => structuredClone(entry)), nextCursor: null }; },
  };
}
const localGlobal = globalThis as typeof globalThis & { espReviewMemory?: SecurityReviewStore; espReviewAudits?: Map<string, AuditDetail> };
export function memoryReviewEnabled() {
  return process.env.ESP_SECURITY_REVIEW_STORE === "memory" && process.env.NODE_ENV === "development" && process.env.ESP_ENVIRONMENT === "dev";
}
export function reviewAuditWriter(): AuditWriter {
  if (!memoryReviewEnabled()) return auditWriter;
  const entries = localGlobal.espReviewAudits ??= new Map();
  return {
    async begin(start) { if (entries.has(start.id)) throw new Error("AUDIT_CONFLICT"); entries.set(start.id, { start: structuredClone(start), result: null }); },
    async finish(result, owner) { const entry = entries.get(result.id); if (!entry || entry.start.actor.subject !== owner || entry.result) throw new Error("AUDIT_CONFLICT"); entry.result = structuredClone(result); },
  };
}
export function readMemoryReviewAudit(id: string, owner: string) {
  const entry = memoryReviewEnabled() ? localGlobal.espReviewAudits?.get(id) : null;
  return entry?.start.actor.subject === owner ? structuredClone(entry) : null;
}
export function securityReviewStore() {
  if (process.env.ESP_SECURITY_REVIEW_STORE === "memory") {
    if (process.env.NODE_ENV !== "development" || process.env.ESP_ENVIRONMENT !== "dev") throw new Error("MEMORY_REVIEW_STORE_NOT_ALLOWED");
    return localGlobal.espReviewMemory ??= createMemorySecurityReviewStore();
  }
  if (process.env.ESP_SECURITY_REVIEW_STORE && process.env.ESP_SECURITY_REVIEW_STORE !== "blob") throw new Error("INVALID_REVIEW_STORE");
  return blobStore;
}