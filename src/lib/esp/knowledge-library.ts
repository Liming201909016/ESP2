import { knowledgeBaseForSkill, knowledgeDocuments, type KnowledgeDocument } from "./knowledge-corpus";
import type { LibraryDetail, LibraryItem, StoredDocument } from "./knowledge-library-contracts";

export function builtinLibraryItem(source: KnowledgeDocument): LibraryItem {
  return {
    id: source.id, origin: "builtin", title: source.title, skillId: source.skillId,
    knowledgeBase: knowledgeBaseForSkill(source.skillId),
    documentNumber: source.documentNumber, owner: source.owner, effectiveDate: source.effectiveDate,
    dataKind: source.dataKind, version: source.version, status: "published", chunkCount: 1,
    updatedAt: source.effectiveDate, filename: `${source.id}.txt`,
  };
}

export function managedLibraryDetail(stored: StoredDocument, canManage: boolean): LibraryDetail {
  const { document, etag } = stored;
  return {
    entry: {
      id: document.id, origin: "imported", title: document.title, skillId: document.skillId,
      knowledgeBase: knowledgeBaseForSkill(document.skillId),
      documentNumber: document.documentNumber, owner: document.owner, effectiveDate: document.effectiveDate,
      dataKind: document.dataKind, version: document.version, status: document.status, chunkCount: document.chunks.length,
      updatedAt: document.updatedAt, filename: document.filename, lastError: document.lastError, operation: document.operation,
    },
    content: document.content,
    chunks: document.chunks,
    provenance: document.provenance,
    etag,
    canManage,
  };
}

export function builtinLibraryDetail(id: string): LibraryDetail | null {
  const source = knowledgeDocuments.find((document) => document.id === id);
  return source ? {
    entry: builtinLibraryItem(source), content: source.content, etag: null, canManage: false,
    chunks: [{ id: source.id, number: 1, start: 0, end: source.content.length, content: source.content }],
  } : null;
}