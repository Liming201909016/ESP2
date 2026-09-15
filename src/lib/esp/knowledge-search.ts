import { DefaultAzureCredential } from "@azure/identity";
import { odata, SearchClient } from "@azure/search-documents";
import enterprisePack from "../../data/enterprise-pack.json";
import {
  knowledgeCorpus,
  knowledgeDataVersion,
  knowledgeDocuments,
  knowledgeDocumentSchema,
  knowledgeIndexName,
  knowledgeIndexForSkill,
  knowledgeSkillIds,
  managedKnowledgeCorpus,
  type KnowledgeDocument,
} from "./knowledge-corpus";

const clients = new Map<string, SearchClient<KnowledgeDocument>>();

function searchClient(indexName = knowledgeIndexName) {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  if (!endpoint) throw new Error("AZURE_SEARCH_ENDPOINT is not configured");
  const key = `${endpoint}/${indexName}`;
  let client = clients.get(key);
  if (!client) {
    client = new SearchClient<KnowledgeDocument>(endpoint, indexName, new DefaultAzureCredential(), { apiVersion: "2025-09-01" });
    clients.set(key, client);
  }
  return client;
}

export async function seedKnowledgeSamples() {
  if (process.env.ESP_ENVIRONMENT !== "dev") throw new Error("Sample import is limited to DEV");
  for (const [index, documents] of Object.entries(Object.groupBy(knowledgeDocuments, (document) => knowledgeIndexForSkill(document.skillId)))) {
    const response = await searchClient(index).mergeOrUploadDocuments(documents!, { abortSignal: AbortSignal.timeout(20_000) });
    if (response.results.length !== documents!.length || response.results.some((result) => !result.succeeded)) {
      throw new Error("Some DEV knowledge documents failed to index");
    }
    for (const expected of documents!) {
      const actual = knowledgeDocumentSchema.parse(await searchClient(index).getDocument(expected.id, { abortSignal: AbortSignal.timeout(15_000) }));
      if (Object.keys(knowledgeDocumentSchema.shape).some((key) => actual[key as keyof KnowledgeDocument] !== expected[key as keyof KnowledgeDocument])) throw new Error("DEV knowledge index verification failed");
    }
  }
  return knowledgeDocuments.length;
}

export async function indexManagedChunks(chunks: KnowledgeDocument[]) {
  if (!chunks.length || chunks.some((chunk) => !knowledgeDocumentSchema.safeParse(chunk).success || chunk.corpus !== managedKnowledgeCorpus || chunk.skillId !== chunks[0].skillId)) throw new Error("Expected managed knowledge chunks");
  const response = await searchClient(knowledgeIndexForSkill(chunks[0].skillId)).mergeOrUploadDocuments(chunks, { abortSignal: AbortSignal.timeout(20_000) });
  if (response.results.length !== chunks.length || response.results.some((result) => !result.succeeded)) {
    throw new Error("Managed document index operation failed");
  }
}

export async function removeManagedChunks(ids: string[], skillId: string) {
  if (!knowledgeSkillIds.some((known) => known === skillId) || !ids.length || ids.some((id) => !/^kb-[a-f0-9]{32}-c\d{3}$/.test(id))) throw new Error("Expected managed chunk IDs and skill");
  const response = await searchClient(knowledgeIndexForSkill(skillId)).deleteDocuments("id", ids, { abortSignal: AbortSignal.timeout(20_000) });
  if (response.results.length !== ids.length || response.results.some((result) => !result.succeeded)) {
    throw new Error("Managed document index cleanup failed");
  }
}

export async function retrieveKnowledge(skillId: string, query: string, options: { policyOnly?: boolean; builtinOnly?: boolean } = {}): Promise<KnowledgeDocument[]> {
  if (!knowledgeSkillIds.some((known) => known === skillId) || !query.trim()) return [];
  const recordIds = [...new Set(query.toUpperCase().match(/(?<![A-Z0-9-])(?:SIM-(?:EMP|PRJ|VEN|LT|MR|MON|NET|EXP|PR|SW|SEC|SR|SOFT)-[A-Z0-9]+(?:-[A-Z0-9]+)*|CC-[A-Z]{2}-\d+)(?![A-Z0-9-])/g) ?? [])];
  const sourceIds = options.policyOnly ? [] : enterprisePack.records.filter((record) => record.skillId === skillId && recordIds.includes(record.id)).map((record) => record.sourceId);
  const baseFilter = options.builtinOnly
    ? odata`skillId eq ${skillId} and permission eq ${"knowledge.read"} and corpus eq ${knowledgeCorpus} and version eq ${knowledgeDataVersion}`
    : odata`skillId eq ${skillId} and permission eq ${"knowledge.read"} and ((corpus eq ${knowledgeCorpus} and version eq ${knowledgeDataVersion}) or corpus eq ${managedKnowledgeCorpus})`;
  if (sourceIds.length > 5) return [];
  const requests = options.policyOnly ? [{ text: query, filter: `${baseFilter} and dataKind eq 'policy'`, top: 10 }] : sourceIds.length ? [
    { text: "*", filter: `${baseFilter} and (${sourceIds.map((id) => odata`id eq ${id}`).join(" or ")})`, top: 5 },
    { text: query, filter: `${baseFilter} and dataKind eq 'policy'`, top: 5 },
  ] : [{ text: recordIds.length ? recordIds.map((id) => `"${id}"`).join(" | ") : query, filter: baseFilter, top: 10 }];
  const documents = new Map<string, KnowledgeDocument>();
  for (const request of requests) {
    const response = await searchClient(knowledgeIndexForSkill(skillId)).search(request.text, {
      filter: request.filter, searchFields: ["title", "section", "content", "searchTerms"], top: request.top,
      queryType: "simple", abortSignal: AbortSignal.timeout(12_000),
    });
    for await (const result of response.results) {
      const document = knowledgeDocumentSchema.parse(result.document);
      const exactRecord = options.policyOnly ? document.dataKind === "policy" : !recordIds.length || (sourceIds.length > 0 ? sourceIds.includes(document.id) || document.dataKind === "policy" : recordIds.some((id) => new RegExp(`(?<![A-Z0-9-])${id}(?![A-Z0-9-])`).test(`${document.content} ${document.searchTerms}`.toUpperCase())));
      if (document.skillId === skillId && result.score > 0 && exactRecord && (!options.builtinOnly || document.corpus === knowledgeCorpus)) documents.set(document.id, document);
    }
  }
  return [...documents.values()].sort((left, right) => Number(sourceIds.includes(right.id)) - Number(sourceIds.includes(left.id)));
}