import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { getConnectorState, listConnectorSourceIds, readConnectorSource, verifyConnectorSource, writeConnectorState } from "./connector-blob";
import { connectorDetailSchema, connectorSyncRequestSchema, type ConnectorDetail, type ConnectorList, type ConnectorSource, type ConnectorState, type ConnectorSyncRequest, type StoredConnectorState } from "./connector-contracts";
import { blobConnectorId, connectorSourceIdSchema } from "./connector-reference";
import { ConnectorError, connectorContainer, connectorSourcePrefix } from "./connector-source";
import { prepareKnowledgeDocument } from "./knowledge-chunks";
import { getManagedDocument, KnowledgeDocumentError, writeManagedDocument } from "./knowledge-document-store";
import { managedLibraryDetail } from "./knowledge-library";
import { knowledgeImportSchema, type ManagedDocument, type StoredDocument } from "./knowledge-library-contracts";

export const connectorSyncLeaseMs = 120_000;
export type ConnectorSyncDependencies = {
  source: (id: string) => Promise<ConnectorSource>;
  verify: (source: ConnectorSource) => Promise<void>;
  state: (id: string) => Promise<StoredConnectorState | null>;
  writeState: (record: ConnectorState, etag: string | null) => Promise<StoredConnectorState>;
  document: (id: string) => Promise<StoredDocument | null>;
  writeDocument: (record: ManagedDocument, etag: string | null) => Promise<StoredDocument>;
  now: () => string;
};
const defaults: ConnectorSyncDependencies = {
  source: readConnectorSource, verify: verifyConnectorSource, state: getConnectorState, writeState: writeConnectorState,
  document: getManagedDocument, writeDocument: writeManagedDocument, now: () => new Date().toISOString(),
};

function matchesDocument(document: ManagedDocument, source: ConnectorSource) {
  const fields = Object.keys(knowledgeImportSchema.shape);
  const input = knowledgeImportSchema.parse(Object.fromEntries(fields.map((field) => [field, document[field as keyof ManagedDocument]])));
  return document.id === source.documentId && isDeepStrictEqual(input, source.input) && document.provenance?.connectorId === blobConnectorId &&
    document.provenance.sourceId === source.id && document.provenance.fingerprint === source.fingerprint && document.provenance.contentSha256 === source.metadata.contentSha256;
}

function detailFor(sourceId: string, source: ConnectorSource | null, sourceError: string | null, state: StoredConnectorState | null, document: StoredDocument | null, canManage: boolean, now: string): ConnectorDetail {
  const locked = state?.record.status === "syncing" && Date.parse(now) - Date.parse(state.record.updatedAt) < connectorSyncLeaseMs;
  return connectorDetailSchema.parse({
    sourceId, source, sourceError, state: state?.record ?? null, stateEtag: state?.etag ?? null,
    document: document ? managedLibraryDetail(document, canManage) : null,
    change: !source ? "unavailable" : document?.document.id === source.documentId ? "unchanged" : state?.record.lastSuccess ? "changed" : "new",
    canSync: canManage && Boolean(source) && !locked,
  });
}

export async function connectorDetails(id: string, canManage: boolean, overrides: Partial<ConnectorSyncDependencies> = {}): Promise<ConnectorDetail> {
  connectorSourceIdSchema.parse(id);
  const dependencies = { ...defaults, ...overrides };
  const state = await dependencies.state(id);
  let source: ConnectorSource | null = null;
  let sourceError: string | null = null;
  try { source = await dependencies.source(id); }
  catch (error) { sourceError = error instanceof ConnectorError ? error.code : "CONNECTOR_SOURCE_UNAVAILABLE"; }
  const documentId = source?.documentId ?? state?.record.lastSuccess?.documentId;
  const document = documentId ? await dependencies.document(documentId) : null;
  if (source && document && !matchesDocument(document.document, source)) throw new ConnectorError("SYNC_TARGET_CONFLICT", 409);
  if (document && document.document.provenance?.sourceId !== id) throw new ConnectorError("SYNC_TARGET_CONFLICT", 409);
  return detailFor(id, source, sourceError, state, document, canManage, dependencies.now());
}

export async function listConnectorSources(canManage: boolean, cursor?: string): Promise<ConnectorList> {
  const configured = Boolean(process.env.AZURE_STORAGE_ACCOUNT);
  const connector: ConnectorList["connector"] = { id: blobConnectorId, name: "Azure Blob 资料同步", version: "0.1.0", configured, container: connectorContainer, prefix: connectorSourcePrefix, mode: "dev-simulation" };
  if (!configured) return { connector, sources: [], nextCursor: null, canSync: false };
  const page = await listConnectorSourceIds(cursor);
  const sources: ConnectorList["sources"] = [];
  for (const id of page.ids) {
    const detail = await connectorDetails(id, canManage);
    sources.push({
      id, title: detail.source?.input.title ?? id, filename: detail.source?.input.filename ?? null,
      documentNumber: detail.source?.input.documentNumber ?? null, skillId: detail.source?.input.skillId ?? null,
      change: detail.change, syncStatus: detail.state?.status ?? null, modifiedAt: detail.source?.modifiedAt ?? null,
      lastDocumentId: detail.state?.lastSuccess?.documentId ?? null, error: detail.sourceError ?? detail.state?.lastError ?? null,
    });
  }
  return { connector, sources, nextCursor: page.nextCursor, canSync: canManage };
}

export async function syncConnectorSource(id: string, input: ConnectorSyncRequest, actor: string, overrides: Partial<ConnectorSyncDependencies> = {}) {
  connectorSourceIdSchema.parse(id);
  if (!actor) throw new ConnectorError("IDENTITY_SUBJECT_REQUIRED", 403);
  const request = connectorSyncRequestSchema.parse(input);
  const dependencies = { ...defaults, ...overrides };
  const source = await dependencies.source(id);
  if (source.fingerprint !== request.fingerprint || source.manifestEtag !== request.manifestEtag || source.contentEtag !== request.contentEtag) throw new ConnectorError("SOURCE_CHANGED", 409);
  const state = await dependencies.state(id);
  if ((state?.etag ?? null) !== request.stateEtag) throw new ConnectorError("SYNC_CONFLICT", 409);
  const now = dependencies.now();
  if (state?.record.status === "syncing" && Date.parse(now) - Date.parse(state.record.updatedAt) < connectorSyncLeaseMs) throw new ConnectorError("SYNC_BUSY", 409);
  const activeRun = { id: randomUUID(), startedAt: now, actor, fingerprint: source.fingerprint, documentId: source.documentId };
  const history = [...(state?.record.history ?? [])];
  if (state?.record.status === "syncing" && state.record.activeRun) history.push({ ...state.record.activeRun, completedAt: now, outcome: "failed", error: "SYNC_INTERRUPTED" });
  const locked = await dependencies.writeState({
    connectorId: blobConnectorId, sourceId: id, status: "syncing", updatedAt: now, lastSuccess: state?.record.lastSuccess ?? null,
    activeRun, history: history.slice(-20),
  }, state?.etag ?? null);
  let document: StoredDocument | null = null;
  let outcome: "created" | "reused" | "failed" = "reused";
  let failure: string | undefined;
  try {
    await dependencies.verify(source);
    document = await dependencies.document(source.documentId);
    if (!document) {
      const record = prepareKnowledgeDocument(source.input, source.documentId, actor, now);
      record.provenance = { connectorId: blobConnectorId, sourceId: id, fingerprint: source.fingerprint, contentSha256: source.metadata.contentSha256, manifestEtag: source.manifestEtag, contentEtag: source.contentEtag, syncedAt: now };
      try { document = await dependencies.writeDocument(record, null); outcome = "created"; }
      catch (error) {
        if (!(error instanceof KnowledgeDocumentError) || error.code !== "CONFLICT") throw error;
        document = await dependencies.document(source.documentId);
        if (!document) throw error;
      }
    }
    if (!matchesDocument(document.document, source)) throw new ConnectorError("SYNC_TARGET_CONFLICT", 409);
  } catch (error) {
    failure = error instanceof ConnectorError ? error.code : "SYNC_DRAFT_UNCONFIRMED";
    outcome = "failed";
    document = null;
  }
  const completedAt = dependencies.now();
  const completed = await dependencies.writeState({
    ...locked.record, status: failure ? "error" : "idle", updatedAt: completedAt, activeRun: null, lastError: failure,
    lastSuccess: failure ? locked.record.lastSuccess : { manifestEtag: source.manifestEtag, contentEtag: source.contentEtag, fingerprint: source.fingerprint, documentId: source.documentId, at: completedAt },
    history: [...locked.record.history, { ...activeRun, completedAt, outcome, ...(failure ? { error: failure } : {}) }].slice(-20),
  }, locked.etag);
  return {
    executionStatus: outcome === "failed" ? "failed" as const : "completed" as const,
    sync: { outcome, documentId: source.documentId, ...(failure ? { error: failure } : {}) },
    detail: detailFor(id, source, null, completed, document, true, completedAt),
  };
}