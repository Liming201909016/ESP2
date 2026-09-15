import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DefaultAzureCredential } from "@azure/identity";
import { SearchClient, SearchIndexClient } from "@azure/search-documents";

const fields = [
  { name: "id", type: "Edm.String", key: true, filterable: true },
  ...["skillId", "corpus", "permission", "version", "organization", "documentNumber", "owner", "effectiveDate", "dataKind"].map((name) => ({ name, type: "Edm.String", filterable: true })),
  ...["title", "section", "content", "searchTerms"].map((name) => ({
    name, type: "Edm.String", searchable: true, analyzerName: "zh-Hans.microsoft",
  })),
];
export async function runKnowledgeIndex(args = process.argv.slice(2), options = {}) {
  assert.ok(args.every((arg) => ["--finance", "--verify-only", "--schema-only"].includes(arg)), "Unknown argument");
  assert.ok(!(args.includes("--verify-only") && args.includes("--schema-only")), "Choose verification or schema setup");
  assert.equal(process.env.ESP_ENVIRONMENT, "dev", "Index bootstrap is limited to DEV");
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  assert.ok(endpoint, "AZURE_SEARCH_ENDPOINT is required");
  const { documents } = options.documents ? options : JSON.parse(await readFile(new URL("../src/data/enterprise-pack.json", import.meta.url), "utf8"));
  assert.ok(documents.length > 0 && documents.every((document) => document.corpus === "esp-dev-samples-v1"));
  const finance = args.includes("--finance");
  const indexName = finance ? "esp-finance-dev-v1" : "esp-knowledge-dev-v1";
  const credential = new DefaultAzureCredential();
  const indexClient = new SearchIndexClient(endpoint, credential, { retryOptions: { maxRetries: 0 } });
  const selected = documents.filter((document) => !finance || document.skillId === "search-expense-policy");
  if (finance && !args.includes("--schema-only")) {
    const legacy = new SearchClient(endpoint, "esp-knowledge-dev-v1", credential, { retryOptions: { maxRetries: 0 } });
    const response = await legacy.search("*", { filter: "skillId eq 'search-expense-policy' and corpus eq 'esp-dev-managed-v1' and permission eq 'knowledge.read'", abortSignal: AbortSignal.timeout(20_000) });
    for await (const result of response.results) {
      const source = result.document;
      assert.ok(source.skillId === "search-expense-policy" && source.corpus === "esp-dev-managed-v1" && source.permission === "knowledge.read" && /^kb-[a-f0-9]{32}-c\d{3}$/.test(source.id), "Unexpected legacy finance source");
      assert.ok(selected.length < 10_000, "Finance migration exceeds bounded document limit");
      selected.push(Object.fromEntries(fields.map((field) => [field.name, source[field.name]])));
    }
  }
  assert.equal(new Set(selected.map((document) => document.id)).size, selected.length, "Duplicate source identifiers");
  for (const document of selected) assert.ok(fields.every((field) => typeof document[field.name] === "string" && document[field.name].length > 0), "Invalid source fields");
  let existing;
  try { existing = await indexClient.getIndex(indexName, { abortSignal: AbortSignal.timeout(20_000) }); }
  catch (error) { if (error.statusCode !== 404 || args.includes("--verify-only")) throw error; }
  if (existing) {
    for (const field of fields) {
      const actual = existing.fields.find((item) => item.name === field.name);
      assert.ok(actual && Object.entries(field).every(([key, value]) => actual[key] === value), "Existing index schema mismatch; no changes applied");
    }
  } else await indexClient.createIndex({ name: indexName, fields }, { abortSignal: AbortSignal.timeout(20_000) });
  if (args.includes("--schema-only")) return { indexName, schema: "verified" };
  const client = new SearchClient(endpoint, indexName, credential, { retryOptions: { maxRetries: 0 } });
  if (!args.includes("--verify-only")) {
    for (let offset = 0; offset < selected.length; offset += 100) {
      const batch = selected.slice(offset, offset + 100);
      const response = await client.mergeOrUploadDocuments(batch, { abortSignal: AbortSignal.timeout(20_000) });
      assert.ok(response.results.length === batch.length && response.results.every((result) => result.succeeded), "Some documents failed to index");
    }
  }
  for (const expected of selected) {
    const actual = await client.getDocument(expected.id, { abortSignal: AbortSignal.timeout(15_000) });
    assert.ok(fields.every((field) => actual[field.name] === expected[field.name]), "Indexed source differs from canonical import");
  }
  if (finance) {
    const foreign = await client.search("*", { filter: "skillId ne 'search-expense-policy' or permission ne 'knowledge.read'", top: 1, abortSignal: AbortSignal.timeout(15_000) });
    for await (const result of foreign.results) assert.fail(`Unexpected non-finance source: ${result.document.id}`);
  }
  return { indexName, sources: selected.length, builtin: selected.filter((document) => document.corpus === "esp-dev-samples-v1").length, managed: selected.filter((document) => document.corpus === "esp-dev-managed-v1").length, verified: true, mode: args.includes("--verify-only") ? "read_only" : "import", legacyDeleted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runKnowledgeIndex()));