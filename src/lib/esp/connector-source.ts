import { createHash } from "node:crypto";
import { z } from "zod";
import { connectorSourceIdSchema } from "./connector-reference";
import { knowledgeImportSchema, type KnowledgeImport } from "./knowledge-library-contracts";

export const connectorSourcePrefix = "connector-sources/knowledge/";
export const connectorContainer = "audit";
export const connectorManifestSchema = knowledgeImportSchema.omit({ content: true }).extend({ contentSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export class ConnectorError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}

export function connectorPaths(sourceId: string, filename?: string) {
  const id = connectorSourceIdSchema.parse(sourceId);
  if (filename) {
    knowledgeImportSchema.shape.filename.parse(filename);
    if (filename.includes("..")) throw new ConnectorError("INVALID_SOURCE_PATH", 400);
  }
  return {
    manifest: `${connectorSourcePrefix}${id}/manifest.json`,
    content: filename ? `${connectorSourcePrefix}${id}/${filename}` : null,
  };
}

export function decodeConnectorText(bytes: Uint8Array, limit: number) {
  if (bytes.byteLength > limit) throw new ConnectorError("SOURCE_TOO_LARGE", 400);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ConnectorError("INVALID_SOURCE_UTF8", 400); }
}

export function parseConnectorManifest(bytes: Uint8Array) {
  try { return connectorManifestSchema.parse(JSON.parse(decodeConnectorText(bytes, 16_384))); }
  catch (error) { if (error instanceof ConnectorError) throw error; throw new ConnectorError("INVALID_SOURCE_MANIFEST", 400); }
}

export function connectorSnapshot(manifest: z.infer<typeof connectorManifestSchema>, bytes: Uint8Array): { input: KnowledgeImport; fingerprint: string } {
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  if (contentSha256 !== manifest.contentSha256) throw new ConnectorError("SOURCE_CONTENT_MISMATCH", 409);
  const { contentSha256: declaredHash, ...metadata } = manifest;
  const parsed = knowledgeImportSchema.safeParse({ ...metadata, content: decodeConnectorText(bytes, 160_000) });
  if (!parsed.success) throw new ConnectorError("INVALID_SOURCE_TEXT", 400);
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...parsed.data, contentSha256: declaredHash })).digest("hex");
  return { input: parsed.data, fingerprint };
}

export function connectorDocumentId(account: string, sourceId: string, fingerprint: string) {
  connectorSourceIdSchema.parse(sourceId);
  z.string().regex(/^[a-f0-9]{64}$/).parse(fingerprint);
  return `kb-${createHash("sha256").update(JSON.stringify([account, connectorContainer, connectorSourcePrefix, sourceId, fingerprint])).digest("hex").slice(0, 32)}`;
}