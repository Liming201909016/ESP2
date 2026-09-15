import { randomUUID } from "node:crypto";
import { prepareKnowledgeDocument } from "./knowledge-chunks";
import { managedKnowledgeCorpus, type KnowledgeDocument } from "./knowledge-corpus";
import { getManagedDocument, KnowledgeDocumentError, writeManagedDocument } from "./knowledge-document-store";
import type { KnowledgeImport, ManagedDocument, StoredDocument } from "./knowledge-library-contracts";

export function searchChunks(document: ManagedDocument): KnowledgeDocument[] {
  return document.chunks.map((chunk) => ({
    id: chunk.id,
    skillId: document.skillId,
    corpus: managedKnowledgeCorpus,
    permission: "knowledge.read",
    version: document.version,
    organization: "澄川数科（虚构组织）",
    documentNumber: document.documentNumber,
    owner: document.owner,
    effectiveDate: document.effectiveDate,
    dataKind: document.dataKind,
    title: document.title,
    section: `片段 ${chunk.number}`,
    content: chunk.content,
    searchTerms: `${document.title} ${document.documentNumber}`,
  }));
}

export async function createKnowledgeDraft(input: KnowledgeImport, createdBy: string) {
  const id = `kb-${randomUUID().replaceAll("-", "")}`;
  return writeManagedDocument(prepareKnowledgeDocument(input, id, createdBy, new Date().toISOString()), null);
}

export type PublicationDependencies = {
  get: (id: string) => Promise<StoredDocument | null>;
  write: (document: ManagedDocument, etag: string) => Promise<StoredDocument>;
  upsert: (chunks: KnowledgeDocument[]) => Promise<void>;
  remove: (ids: string[], skillId: string) => Promise<void>;
  now: () => string;
};

export async function changeKnowledgePublication(
  id: string,
  action: "publish" | "deactivate",
  expectedEtag: string,
  dependencies: PublicationDependencies,
): Promise<StoredDocument> {
  const current = await dependencies.get(id);
  if (!current) throw new KnowledgeDocumentError("NOT_FOUND");
  if (current.etag !== expectedEtag) throw new KnowledgeDocumentError("CONFLICT");
  const now = dependencies.now();
  if (current.document.status === "indexing" && Date.parse(now) - Date.parse(current.document.updatedAt) < 120_000) {
    throw new KnowledgeDocumentError("BUSY");
  }
  const locked = await dependencies.write({ ...current.document, status: "indexing", operation: action, updatedAt: now, lastError: undefined }, current.etag);
  let failed = false;
  try {
    if (action === "publish") await dependencies.upsert(searchChunks(locked.document));
    else await dependencies.remove(locked.document.chunks.map((chunk) => chunk.id), locked.document.skillId);
  } catch {
    failed = true;
  }
  return dependencies.write({
    ...locked.document,
    status: action === "deactivate" ? "inactive" : failed ? "error" : "published",
    operation: undefined,
    lastError: failed ? action === "deactivate" ? "INDEX_CLEANUP_FAILED" : "INDEX_PUBLISH_FAILED" : undefined,
    updatedAt: dependencies.now(),
  }, locked.etag);
}

export const knowledgePublicationStore = { get: getManagedDocument, write: writeManagedDocument, now: () => new Date().toISOString() };