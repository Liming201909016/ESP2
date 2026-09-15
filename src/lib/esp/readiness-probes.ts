import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { SearchClient } from "@azure/search-documents";
import { knowledgeCorpus, knowledgeDataVersion, knowledgeDocuments, knowledgeIndexForSkill, type KnowledgeDocument } from "./knowledge-corpus";
import { postgresSql } from "./postgres";
import { stateBackend } from "./state-config";
import { createReadinessCheck, type ProbeStatus } from "./readiness";

const credential = new DefaultAzureCredential();

async function blob(): Promise<ProbeStatus> {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account || !/^[a-z0-9]{3,24}$/.test(account)) return "not_configured";
  const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential, { retryOptions: { maxTries: 1 } }).getContainerClient("audit");
  await container.getProperties({ abortSignal: AbortSignal.timeout(15_000) });
  return "healthy";
}

async function search(): Promise<ProbeStatus> {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  if (!endpoint) return "not_configured";
  const sentinels = new Map<string, KnowledgeDocument>();
  for (const source of knowledgeDocuments) {
    const index = knowledgeIndexForSkill(source.skillId);
    if (!sentinels.has(index)) sentinels.set(index, source);
  }
  const checks = await Promise.all([...sentinels].map(async ([index, expected]) => {
    const client = new SearchClient<KnowledgeDocument>(endpoint, index, credential, { retryOptions: { maxRetries: 0 } });
    const document = await client.getDocument(expected.id, { abortSignal: AbortSignal.timeout(15_000) });
    return document.corpus === knowledgeCorpus && document.version === knowledgeDataVersion && document.skillId === expected.skillId && document.content === expected.content;
  }));
  return checks.every(Boolean) ? "healthy" : "unavailable";
}

async function state(): Promise<ProbeStatus> {
  if (stateBackend() !== "postgres") return "not_required";
  const result = await postgresSql.query("SELECT 1 AS ready");
  return result.rows[0]?.ready === 1 ? "healthy" : "unavailable";
}

export const dependencyReadiness = createReadinessCheck({ blob, search, state });