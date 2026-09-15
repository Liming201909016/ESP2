import { afterEach, beforeEach, expect, it, vi } from "vitest";
import pack from "../src/data/enterprise-pack.json";

const state = vi.hoisted(() => ({ getIndex: vi.fn(), createIndex: vi.fn(), search: vi.fn(), upload: vi.fn(), getDocument: vi.fn(), indexes: [] as string[] }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/search-documents", () => ({
  SearchIndexClient: class { getIndex = state.getIndex; createIndex = state.createIndex; },
  SearchClient: class {
    constructor(_endpoint: string, index: string) { state.indexes.push(index); }
    search = state.search; mergeOrUploadDocuments = state.upload; getDocument = state.getDocument;
  },
}));
import { runKnowledgeIndex } from "./index-knowledge.mjs";

beforeEach(() => {
  vi.resetAllMocks(); state.indexes.length = 0;
  vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("AZURE_SEARCH_ENDPOINT", "https://example.search.windows.net");
  state.getIndex.mockRejectedValue({ statusCode: 404 });
  state.search.mockImplementation(async () => ({ results: (async function* () {})() }));
  state.upload.mockImplementation(async (documents: { id: string }[]) => ({ results: documents.map((document) => ({ key: document.id, succeeded: true })) }));
  state.getDocument.mockImplementation(async (id: string) => pack.documents.find((document) => document.id === id));
});
afterEach(() => vi.unstubAllEnvs());

it("creates and verifies only the finance index without deleting or republishing originals", async () => {
  const result = await runKnowledgeIndex(["--finance"]);
  expect(result).toMatchObject({ indexName: "esp-finance-dev-v1", verified: true, managed: 0, legacyDeleted: false });
  expect(result.builtin).toBe(pack.documents.filter((document) => document.skillId === "search-expense-policy").length);
  expect(state.createIndex).toHaveBeenCalledWith(expect.objectContaining({ name: "esp-finance-dev-v1" }), expect.any(Object));
  expect(state.upload.mock.calls.flatMap((call) => call[0]).every((document) => document.skillId === "search-expense-policy")).toBe(true);
});

it("supports bundled startup data without depending on a source-tree file", async () => {
  expect(await runKnowledgeIndex(["--finance"], { documents: pack.documents })).toMatchObject({ verified: true });
});

it("refuses a foreign managed source before creating or uploading", async () => {
  state.search.mockResolvedValue({ results: (async function* () { yield { document: pack.documents[0] }; })() });
  await expect(runKnowledgeIndex(["--finance"])).rejects.toThrow("Unexpected legacy finance source");
  expect(state.createIndex).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
});

it("copies existing managed finance chunks without changing their identity or content", async () => {
  const managed = { ...pack.documents.find((document) => document.skillId === "search-expense-policy")!, id: "kb-0123456789abcdef0123456789abcdef-c001", corpus: "esp-dev-managed-v1", version: "1" };
  state.search.mockResolvedValueOnce({ results: (async function* () { yield { document: managed }; })() });
  state.getDocument.mockImplementation(async (id: string) => id === managed.id ? managed : pack.documents.find((document) => document.id === id));
  expect(await runKnowledgeIndex(["--finance"])).toMatchObject({ managed: 1, verified: true });
  expect(state.upload.mock.calls.flatMap((call) => call[0])).toContainEqual(managed);
});

it("fails closed on a missing index during read-only verification", async () => {
  await expect(runKnowledgeIndex(["--finance", "--verify-only"])).rejects.toMatchObject({ statusCode: 404 });
  expect(state.createIndex).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
});

it("does not overwrite an incompatible existing schema", async () => {
  state.getIndex.mockResolvedValue({ fields: [] });
  await expect(runKnowledgeIndex(["--finance"])).rejects.toThrow("schema mismatch");
  expect(state.createIndex).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
});

it("rejects incomplete indexing and altered source text", async () => {
  state.upload.mockResolvedValue({ results: [] });
  await expect(runKnowledgeIndex(["--finance"])).rejects.toThrow("failed to index");
  state.upload.mockImplementation(async (documents: { id: string }[]) => ({ results: documents.map((document) => ({ key: document.id, succeeded: true })) }));
  state.getDocument.mockResolvedValue(pack.documents[0]);
  await expect(runKnowledgeIndex(["--finance"])).rejects.toThrow("canonical import");
});