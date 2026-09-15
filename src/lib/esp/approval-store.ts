import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { text as readStreamText } from "node:stream/consumers";
import { ApprovalError, approvalIdSchema, approvalRecordSchema, type ApprovalRecord, type StoredApproval } from "./approval-contracts";
import { postgresStateStore } from "./postgres-state";
import { assertStateWritesAvailable, stateBackend } from "./state-config";

function containerClient() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error("AZURE_STORAGE_ACCOUNT is not configured");
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient("audit");
}

function approvalPath(id: string) { return `approvals/${approvalIdSchema.parse(id)}.json`; }

export async function getApproval(id: string): Promise<StoredApproval | null> {
  if (stateBackend() === "postgres") return postgresStateStore().getApproval(id);
  try {
    const response = await containerClient().getBlobClient(approvalPath(id)).download(0, undefined, { abortSignal: AbortSignal.timeout(15_000) });
    if (!response.readableStreamBody || !response.etag) throw new Error("Incomplete approval response");
    const parsed = approvalRecordSchema.safeParse(JSON.parse(await readStreamText(response.readableStreamBody)));
    if (!parsed.success || parsed.data.id !== id) throw new Error("Invalid stored approval");
    return { record: parsed.data, etag: response.etag };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "BlobNotFound") return null;
    throw error;
  }
}

export async function writeApproval(record: ApprovalRecord, etag: string | null): Promise<StoredApproval> {
  assertStateWritesAvailable();
  if (stateBackend() === "postgres") return postgresStateStore().writeApproval(record, etag);
  const parsed = approvalRecordSchema.parse(record);
  const body = JSON.stringify(parsed);
  try {
    const response = await containerClient().getBlockBlobClient(approvalPath(parsed.id)).upload(body, Buffer.byteLength(body), {
      conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }, abortSignal: AbortSignal.timeout(15_000),
    });
    if (!response.etag) throw new Error("Approval write did not return an ETag");
    return { record: parsed, etag: response.etag };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ConditionNotMet" || code === "BlobAlreadyExists" || (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 412)) throw new ApprovalError("CONFLICT", 409);
    throw error;
  }
}

export async function listApprovals(createdBy: string, cursor?: string): Promise<{ approvals: StoredApproval[]; nextCursor: string | null }> {
  if (stateBackend() === "postgres") return postgresStateStore().listApprovals(createdBy, cursor);
  const pages = containerClient().listBlobsFlat({ prefix: "approvals/", abortSignal: AbortSignal.timeout(15_000) }).byPage({ continuationToken: cursor, maxPageSize: 20 });
  const page = await pages.next();
  if (page.done) return { approvals: [], nextCursor: null };
  const approvals: StoredApproval[] = [];
  for (const item of page.value.segment.blobItems) {
    const id = /^approvals\/(apr-[a-f0-9]{32})\.json$/.exec(item.name)?.[1];
    if (!id) continue;
    const stored = await getApproval(id);
    if (stored?.record.createdBy === createdBy) approvals.push(stored);
  }
  return { approvals, nextCursor: page.value.continuationToken || null };
}