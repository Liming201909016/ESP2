import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import type { Readable } from "node:stream";
import { connectorSourceIdSchema, blobConnectorId } from "./connector-reference";
import { connectorStateSchema, type ConnectorSource, type ConnectorState, type StoredConnectorState } from "./connector-contracts";
import { ConnectorError, connectorContainer, connectorDocumentId, connectorPaths, connectorSnapshot, connectorSourcePrefix, decodeConnectorText, parseConnectorManifest } from "./connector-source";
import { chunkKnowledgeText } from "./knowledge-chunks";
import { connectorExamples, connectorExampleFiles } from "./connector-examples";

function accountName() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account || !/^[a-z0-9]{3,24}$/.test(account)) throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", 503);
  return account;
}

function containerClient() {
  return new BlobServiceClient(`https://${accountName()}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient(connectorContainer);
}

function normalizedEtag(etag?: string) {
  if (!etag) throw new ConnectorError("SOURCE_RESPONSE_INCOMPLETE");
  return etag.startsWith('"') ? etag : `"${etag}"`;
}

function sourceError(error: unknown): never {
  if (error instanceof ConnectorError) throw error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
  if (code === "BlobNotFound") throw new ConnectorError("SOURCE_NOT_FOUND", 404);
  if (code === "ConditionNotMet" || status === 412) throw new ConnectorError("SOURCE_CHANGED", 409);
  throw new ConnectorError("CONNECTOR_STORAGE_UNAVAILABLE");
}

async function readBytes(path: string, limit: number, expectedEtag?: string) {
  try {
    const response = await containerClient().getBlobClient(path).download(0, undefined, {
      abortSignal: AbortSignal.timeout(15_000), ...(expectedEtag ? { conditions: { ifMatch: normalizedEtag(expectedEtag) } } : {}),
    });
    const stream = response.readableStreamBody as Readable | undefined;
    if (!stream) throw new ConnectorError("SOURCE_RESPONSE_INCOMPLETE");
    if ((response.contentLength ?? 0) > limit) { stream.destroy(); throw new ConnectorError("SOURCE_TOO_LARGE", 400); }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > limit) { stream.destroy(); throw new ConnectorError("SOURCE_TOO_LARGE", 400); }
      chunks.push(bytes);
    }
    if (!response.lastModified) throw new ConnectorError("SOURCE_RESPONSE_INCOMPLETE");
    return { bytes: Buffer.concat(chunks), etag: normalizedEtag(response.etag), modifiedAt: response.lastModified.toISOString() };
  } catch (error) { return sourceError(error); }
}

export async function verifyConnectorSource(source: Pick<ConnectorSource, "id" | "manifestEtag" | "contentEtag" | "input">) {
  const paths = connectorPaths(source.id, source.input.filename);
  try {
    await containerClient().getBlobClient(paths.manifest).getProperties({ conditions: { ifMatch: source.manifestEtag }, abortSignal: AbortSignal.timeout(15_000) });
    await containerClient().getBlobClient(paths.content!).getProperties({ conditions: { ifMatch: source.contentEtag }, abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) { sourceError(error); }
}

export async function readConnectorSource(id: string): Promise<ConnectorSource> {
  const sourceId = connectorSourceIdSchema.parse(id);
  const manifest = await readBytes(connectorPaths(sourceId).manifest, 16_384);
  const metadata = parseConnectorManifest(manifest.bytes);
  const content = await readBytes(connectorPaths(sourceId, metadata.filename).content!, 160_000);
  const snapshot = connectorSnapshot(metadata, content.bytes);
  const documentId = connectorDocumentId(accountName(), sourceId, snapshot.fingerprint);
  const source: ConnectorSource = {
    id: sourceId, metadata, ...snapshot, documentId, bytes: content.bytes.byteLength,
    manifestEtag: manifest.etag, contentEtag: content.etag,
    modifiedAt: manifest.modifiedAt > content.modifiedAt ? manifest.modifiedAt : content.modifiedAt,
    chunks: chunkKnowledgeText(documentId, snapshot.input.content),
  };
  await verifyConnectorSource(source);
  return source;
}

export async function listConnectorSourceIds(cursor?: string) {
  const page = await containerClient().listBlobsFlat({ prefix: connectorSourcePrefix, abortSignal: AbortSignal.timeout(15_000) }).byPage({ continuationToken: cursor, maxPageSize: 20 }).next();
  if (page.done) return { ids: [], nextCursor: null };
  const ids = page.value.segment.blobItems.flatMap((item) => {
    const suffix = item.name.slice(connectorSourcePrefix.length);
    const match = /^([a-z0-9][a-z0-9-]{2,63})\/manifest\.json$/.exec(suffix);
    return item.name.startsWith(connectorSourcePrefix) && match ? [match[1]] : [];
  });
  return { ids, nextCursor: page.value.continuationToken || null };
}

function statePath(id: string) { return `connectors/${blobConnectorId}/state/${connectorSourceIdSchema.parse(id)}.json`; }

export async function getConnectorState(id: string): Promise<StoredConnectorState | null> {
  try {
    const response = await readBytes(statePath(id), 65_536);
    const parsed = connectorStateSchema.safeParse(JSON.parse(decodeConnectorText(response.bytes, 65_536)));
    if (!parsed.success || parsed.data.sourceId !== id) throw new ConnectorError("INVALID_SYNC_RECORD");
    return { record: parsed.data, etag: response.etag };
  } catch (error) {
    if (error instanceof ConnectorError && error.code === "SOURCE_NOT_FOUND") return null;
    if (error instanceof SyntaxError) throw new ConnectorError("INVALID_SYNC_RECORD");
    throw error;
  }
}

export async function writeConnectorState(record: ConnectorState, etag: string | null): Promise<StoredConnectorState> {
  const parsed = connectorStateSchema.parse(record);
  const body = JSON.stringify(parsed);
  try {
    const response = await containerClient().getBlockBlobClient(statePath(parsed.sourceId)).upload(body, Buffer.byteLength(body), {
      conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" }, abortSignal: AbortSignal.timeout(15_000),
    });
    return { record: parsed, etag: normalizedEtag(response.etag) };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    if (code === "BlobAlreadyExists" || code === "ConditionNotMet" || status === 412) throw new ConnectorError("SYNC_CONFLICT", 409);
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError("SYNC_RECORD_UNAVAILABLE");
  }
}

async function createSourceBlob(path: string, bytes: Buffer, contentType: string) {
  try {
    await containerClient().getBlockBlobClient(path).upload(bytes, bytes.byteLength, {
      conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: contentType }, abortSignal: AbortSignal.timeout(15_000),
    });
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    if (code === "BlobAlreadyExists" || code === "ConditionNotMet" || status === 412) return false;
    throw new ConnectorError("EXAMPLE_SOURCE_UNAVAILABLE");
  }
}

export async function seedConnectorExamples() {
  const results: { sourceId: string; outcome: "created" | "existing" | "failed"; error?: string }[] = [];
  for (const example of connectorExamples) {
    const files = connectorExampleFiles(example);
    const paths = connectorPaths(files.id, files.manifest.filename);
    try {
      try {
        await readBytes(paths.manifest, 16_384);
        results.push({ sourceId: files.id, outcome: "existing" }); continue;
      } catch (error) {
        if (!(error instanceof ConnectorError && error.code === "SOURCE_NOT_FOUND")) throw new ConnectorError("EXAMPLE_SOURCE_UNAVAILABLE");
      }
      const createdContent = await createSourceBlob(paths.content!, files.content, "text/plain; charset=utf-8");
      if (!createdContent) {
        const existing = await readBytes(paths.content!, 160_000);
        if (!existing.bytes.equals(files.content)) throw new ConnectorError("EXAMPLE_SOURCE_CONFLICT", 409);
      }
      const createdManifest = await createSourceBlob(paths.manifest, files.manifestBytes, "application/json; charset=utf-8");
      results.push({ sourceId: files.id, outcome: createdManifest ? "created" : "existing" });
    } catch (error) { results.push({ sourceId: files.id, outcome: "failed", error: error instanceof ConnectorError ? error.code : "EXAMPLE_SOURCE_UNAVAILABLE" }); }
  }
  return { executionStatus: results.some((result) => result.outcome === "failed") ? "failed" as const : "completed" as const, examples: results };
}