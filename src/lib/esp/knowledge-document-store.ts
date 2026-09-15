import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { text as readStreamText } from "node:stream/consumers";
import { managedDocumentIdSchema, managedDocumentSchema, type ManagedDocument, type StoredDocument } from "./knowledge-library-contracts";
import { chunkKnowledgeText } from "./knowledge-chunks";

export class KnowledgeDocumentError extends Error {
  constructor(public code: "NOT_FOUND" | "CONFLICT" | "BUSY") {
    super(code);
  }
}

function containerClient() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error("AZURE_STORAGE_ACCOUNT is not configured");
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient("audit");
}

function documentPath(id: string) {
  return `knowledge/documents/${managedDocumentIdSchema.parse(id)}.json`;
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

export async function getManagedDocument(id: string): Promise<StoredDocument | null> {
  try {
    const response = await containerClient().getBlobClient(documentPath(id)).download(0, undefined, {
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!response.readableStreamBody || !response.etag) throw new Error("Document response is incomplete");
    const parsed = managedDocumentSchema.safeParse(JSON.parse(await readStreamText(response.readableStreamBody)));
    if (!parsed.success) throw new Error("Stored knowledge document is invalid");
    const document = parsed.data;
    if (document.id !== id) throw new Error("Stored document ID does not match");
    const chunks = chunkKnowledgeText(id, document.content);
    if (chunks.length !== document.chunks.length || chunks.some((chunk, index) => {
      const stored = document.chunks[index];
      return chunk.id !== stored.id || chunk.start !== stored.start || chunk.end !== stored.end || chunk.content !== stored.content || chunk.number !== stored.number;
    })) throw new Error("Stored knowledge chunk ranges are invalid");
    return { document, etag: response.etag };
  } catch (error) {
    if (errorCode(error) === "BlobNotFound") return null;
    throw error;
  }
}

export async function writeManagedDocument(document: ManagedDocument, etag: string | null): Promise<StoredDocument> {
  const parsed = managedDocumentSchema.parse(document);
  const body = JSON.stringify(parsed);
  try {
    const response = await containerClient().getBlockBlobClient(documentPath(document.id)).upload(body, Buffer.byteLength(body), {
      conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!response.etag) throw new Error("Document write did not return an ETag");
    return { document: parsed, etag: response.etag };
  } catch (error) {
    if (["ConditionNotMet", "BlobAlreadyExists"].includes(String(errorCode(error))) ||
      (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 412)) throw new KnowledgeDocumentError("CONFLICT");
    throw error;
  }
}

export async function listManagedDocuments(cursor?: string): Promise<{ documents: StoredDocument[]; nextCursor: string | null }> {
  const pages = containerClient().listBlobsFlat({ prefix: "knowledge/documents/", abortSignal: AbortSignal.timeout(15_000) })
    .byPage({ continuationToken: cursor, maxPageSize: 20 });
  const page = await pages.next();
  if (page.done) return { documents: [], nextCursor: null };
  const documents: StoredDocument[] = [];
  for (const item of page.value.segment.blobItems) {
    const match = /^knowledge\/documents\/(kb-[a-f0-9]{32})\.json$/.exec(item.name);
    if (!match) continue;
    const stored = await getManagedDocument(match[1]);
    if (stored) documents.push(stored);
  }
  return { documents, nextCursor: page.value.continuationToken || null };
}