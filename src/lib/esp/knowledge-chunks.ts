import { knowledgeImportSchema, managedDocumentIdSchema, type KnowledgeChunk, type KnowledgeImport, type ManagedDocument } from "./knowledge-library-contracts";

export function chunkKnowledgeText(documentId: string, text: string): KnowledgeChunk[] {
  managedDocumentIdSchema.parse(documentId);
  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 1_800, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline >= start + 900) end = newline + 1;
      if (/^[\uDC00-\uDFFF]$/.test(text[end]) && /[\uD800-\uDBFF]$/.test(text[end - 1])) end -= 1;
    }
    const content = text.slice(start, end);
    const number = chunks.length + 1;
    chunks.push({ id: `${documentId}-c${String(number).padStart(3, "0")}`, number, start, end, content });
    start = end;
  }
  return chunks;
}

export function prepareKnowledgeDocument(input: KnowledgeImport, id: string, createdBy: string, now: string): ManagedDocument {
  const parsed = knowledgeImportSchema.parse(input);
  return {
    ...parsed,
    id: managedDocumentIdSchema.parse(id),
    chunks: chunkKnowledgeText(id, parsed.content),
    version: "1",
    status: "draft",
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}