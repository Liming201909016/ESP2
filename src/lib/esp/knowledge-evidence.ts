import { knowledgeDocuments, managedKnowledgeCorpus, type KnowledgeDocument } from "./knowledge-corpus";
import { getManagedDocument } from "./knowledge-document-store";
import { searchChunks } from "./knowledge-publication";

export function managedSourceDocumentId(sourceId: string) {
  return /^(kb-[a-f0-9]{32})-c\d{3}$/.exec(sourceId)?.[1] ?? null;
}

export async function publishedKnowledgeSource(sourceId: string, load = getManagedDocument): Promise<KnowledgeDocument | null> {
  const builtin = knowledgeDocuments.find((document) => document.id === sourceId);
  if (builtin) return builtin;
  const id = managedSourceDocumentId(sourceId);
  if (!id) return null;
  const stored = await load(id);
  if (stored?.document.status !== "published") return null;
  return searchChunks(stored.document).find((chunk) => chunk.id === sourceId) ?? null;
}

export async function resolveKnowledgeEvidence(retrieved: KnowledgeDocument[], skillId: string, load = getManagedDocument) {
  const cached = new Map<string, ReturnType<typeof getManagedDocument>>();
  const loadOnce: typeof getManagedDocument = (id) => {
    if (!cached.has(id)) cached.set(id, load(id));
    return cached.get(id)!;
  };
  const sources: KnowledgeDocument[] = [];
  for (const document of retrieved) {
    if (document.skillId !== skillId) continue;
    if (document.corpus === managedKnowledgeCorpus && !managedSourceDocumentId(document.id)) continue;
    const source = await publishedKnowledgeSource(document.id, loadOnce);
    if (source && source.skillId === skillId && source.corpus === document.corpus &&
      source.version === document.version && source.content === document.content && !sources.some((item) => item.id === source.id)) {
      sources.push(source);
    }
  }
  return sources;
}