import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeDocuments } from "./knowledge-corpus";

const { search, mergeOrUploadDocuments, deleteDocuments, constructed, getDocument } = vi.hoisted(() => ({
  search: vi.fn(), mergeOrUploadDocuments: vi.fn(), deleteDocuments: vi.fn(), constructed: vi.fn(), getDocument: vi.fn(),
}));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/search-documents", async (importOriginal) => {
  const original = await importOriginal<typeof import("@azure/search-documents")>();
  return {
    ...original,
    SearchClient: class {
      constructor(endpoint: string, index: string) { constructed(endpoint, index); }
      search = search;
      mergeOrUploadDocuments = mergeOrUploadDocuments;
      deleteDocuments = deleteDocuments;
      getDocument = getDocument;
    },
  };
});

import { indexManagedChunks, removeManagedChunks, retrieveKnowledge, seedKnowledgeSamples } from "./knowledge-search";

beforeEach(() => {
  vi.resetAllMocks();
  getDocument.mockImplementation(async (id: string) => knowledgeDocuments.find((document) => document.id === id));
  vi.stubEnv("ESP_ENVIRONMENT", "dev");
  vi.stubEnv("AZURE_SEARCH_ENDPOINT", "https://example.search.windows.net");
  vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("knowledge retrieval", () => {
  it("keeps policy-only guidance independent of incidental asset IDs and excludes snapshots", async () => {
    const policy = knowledgeDocuments.find((document) => document.id === "dev-software-service")!;
    const asset = knowledgeDocuments.find((document) => document.id === "dev-lt-0042")!;
    search.mockResolvedValue({ results: (async function* () {
      yield { document: asset, score: 10 };
      yield { document: policy, score: 2 };
    })() });
    await expect(retrieveKnowledge("search-software-catalog", "IT 服务台规范 SIM-LT-0042", { policyOnly: true })).resolves.toEqual([policy]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("IT 服务台规范 SIM-LT-0042", expect.objectContaining({ filter: expect.stringContaining("and dataKind eq 'policy'"), top: 10 }));
  });

  it("preserves exact asset lookup for ordinary software queries", async () => {
    const asset = knowledgeDocuments.find((document) => document.id === "dev-lt-0042")!;
    const policy = knowledgeDocuments.find((document) => document.id === "dev-software-service")!;
    search.mockResolvedValueOnce({ results: (async function* () { yield { document: asset, score: 1 }; })() });
    search.mockResolvedValueOnce({ results: (async function* () { yield { document: policy, score: 2 }; })() });
    await expect(retrieveKnowledge("search-software-catalog", "设备 SIM-LT-0042 的使用人和状态")).resolves.toEqual([asset, policy]);
    expect(search).toHaveBeenNthCalledWith(1, "*", expect.objectContaining({ filter: expect.stringContaining("id eq 'dev-lt-0042'") }));
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("isolates finance in its own index without changing HR routing", async () => {
    vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "true");
    vi.resetModules();
    const isolated = await import("./knowledge-search");
    search.mockImplementation(async () => ({ results: (async function* () {})() }));
    await isolated.retrieveKnowledge("search-expense-policy", "北京住宿标准");
    await isolated.retrieveKnowledge("search-company-policy", "年假制度");
    expect(constructed.mock.calls.map((call) => call[1])).toEqual(["esp-finance-dev-v1", "esp-knowledge-dev-v1"]);
  });

  it("keeps legacy routing when the second knowledge base is disabled", async () => {
    vi.resetModules();
    const isolated = await import("./knowledge-search");
    search.mockResolvedValue({ results: (async function* () {})() });
    await isolated.retrieveKnowledge("search-expense-policy", "北京住宿标准");
    expect(constructed).toHaveBeenCalledWith("https://example.search.windows.net", "esp-knowledge-dev-v1");
  });

  it("does not fall back to the original index when finance fails", async () => {
    vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "true");
    vi.resetModules();
    const isolated = await import("./knowledge-search");
    search.mockRejectedValue(new Error("Finance unavailable"));
    await expect(isolated.retrieveKnowledge("search-expense-policy", "北京住宿标准")).rejects.toThrow("Finance unavailable");
    expect(search).toHaveBeenCalledTimes(1);
    expect(constructed.mock.calls.map((call) => call[1])).toEqual(["esp-finance-dev-v1"]);
  });

  it("constrains retrieval to the matched scenario and labelled sample corpus", async () => {
    search.mockResolvedValue({ results: (async function* () {
      yield { document: knowledgeDocuments[0], score: 2 };
      yield { document: knowledgeDocuments[2], score: 2 };
    })() });
    await expect(retrieveKnowledge("search-company-policy", "leave policy")).resolves.toEqual([knowledgeDocuments[0]]);
    expect(search).toHaveBeenCalledWith("leave policy", expect.objectContaining({
      filter: "skillId eq 'search-company-policy' and permission eq 'knowledge.read' and ((corpus eq 'esp-dev-samples-v1' and version eq '2026.09-sim-v4') or corpus eq 'esp-dev-managed-v1')",
      top: 10,
    }));
  });

  it("does not broaden an unknown scenario or empty query", async () => {
    await expect(retrieveKnowledge("invalid' or true", "policy")).resolves.toEqual([]);
    await expect(retrieveKnowledge("search-company-policy", " ")).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("propagates dependency errors instead of inventing a result", async () => {
    search.mockRejectedValue(new Error("Search unavailable"));
    await expect(retrieveKnowledge("search-company-policy", "leave")).rejects.toThrow("Search unavailable");
  });
  it("pins an explicit business number to its record while retaining policy context", async () => {
    const record = knowledgeDocuments.find((document) => document.id === "dev-exp-202609-0018")!;
    const policy = knowledgeDocuments.find((document) => document.id === "dev-travel-approval")!;
    search.mockResolvedValueOnce({ results: (async function* () { yield { document: record, score: 1 }; })() });
    search.mockResolvedValueOnce({ results: (async function* () { yield { document: policy, score: 10 }; })() });
    await expect(retrieveKnowledge("search-expense-policy", "报销单 SIM-EXP-202609-0018 为何超标？")).resolves.toEqual([record, policy]);
    expect(search).toHaveBeenNthCalledWith(1, "*", expect.objectContaining({ filter: expect.stringContaining("(id eq 'dev-exp-202609-0018')"), top: 5 }));
    expect(search).toHaveBeenNthCalledWith(2, "报销单 SIM-EXP-202609-0018 为何超标？", expect.objectContaining({ filter: expect.stringContaining("and dataKind eq 'policy'"), top: 5 }));
  });
  it("does not substitute a nearby person for a missing identifier", async () => {
    search.mockResolvedValue({ results: (async function* () { yield { document: knowledgeDocuments.find((document) => document.id === "dev-emp-1001"), score: 4 }; })() });
    await expect(retrieveKnowledge("search-company-policy", "员工 SIM-EMP-9999 的年假余额")).resolves.toEqual([]);
    expect(search).toHaveBeenCalledWith('"SIM-EMP-9999"', expect.any(Object));
  });
  it("still accepts an exact identifier supplied by a published managed source", async () => {
    const record = { ...knowledgeDocuments[0], id: "kb-0123456789abcdef0123456789abcdef-c001", corpus: "esp-dev-managed-v1", content: "【模拟数据】员工 SIM-EMP-9999 的合成余额为4天。", searchTerms: "SIM-EMP-9999" };
    search.mockResolvedValue({ results: (async function* () { yield { document: record, score: 1 }; })() });
    await expect(retrieveKnowledge("search-company-policy", "员工 SIM-EMP-9999 的年假余额")).resolves.toEqual([record]);
  });
  it.each(["SIM-EMP-10010", "SIM-EMP-1001-OLD"])("does not truncate or substitute the identifier %s", async (identifier) => {
    search.mockResolvedValue({ results: (async function* () { yield { document: knowledgeDocuments.find((document) => document.id === "dev-emp-1001"), score: 5 }; })() });
    await expect(retrieveKnowledge("search-company-policy", `员工 ${identifier} 的年假余额`)).resolves.toEqual([]);
    expect(search).toHaveBeenCalledWith(`"${identifier}"`, expect.any(Object));
  });
  it("rejects an unknown identifier present only as a longer identifier prefix", async () => {
    const record = { ...knowledgeDocuments[0], content: "合成员工 SIM-EMP-99990 年假额度", searchTerms: "SIM-EMP-99990" };
    search.mockResolvedValue({ results: (async function* () { yield { document: record, score: 1 }; })() });
    await expect(retrieveKnowledge("search-company-policy", "员工 SIM-EMP-9999 年假")).resolves.toEqual([]);
  });
});

describe("DEV sample import", () => {
  it("fails when an uploaded document does not match the canonical original", async () => {
    mergeOrUploadDocuments.mockResolvedValue({ results: knowledgeDocuments.map((document) => ({ key: document.id, succeeded: true })) });
    getDocument.mockResolvedValue({ ...knowledgeDocuments[0], content: "Incorrect indexed content" });
    await expect(seedKnowledgeSamples()).rejects.toThrow("verification failed");
  });

  it("seeds and verifies both configured indexes without touching managed publications", async () => {
    vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "true"); vi.resetModules();
    const isolated = await import("./knowledge-search");
    mergeOrUploadDocuments.mockImplementation(async (documents: { id: string }[]) => ({ results: documents.map((document) => ({ key: document.id, succeeded: true })) }));
    expect(await isolated.seedKnowledgeSamples()).toBe(101);
    expect(constructed.mock.calls.map((call) => call[1]).sort()).toEqual(["esp-finance-dev-v1", "esp-knowledge-dev-v1"]);
    expect(getDocument).toHaveBeenCalledTimes(101);
    expect(mergeOrUploadDocuments.mock.calls.flatMap((call) => call[0]).every((document) => document.corpus === "esp-dev-samples-v1")).toBe(true);
  });

  it("upserts all versioned source sections", async () => {
    mergeOrUploadDocuments.mockResolvedValue({ results: knowledgeDocuments.map((document) => ({ key: document.id, succeeded: true })) });
    await expect(seedKnowledgeSamples()).resolves.toBe(knowledgeDocuments.length);
    expect(mergeOrUploadDocuments).toHaveBeenCalledWith(knowledgeDocuments, expect.any(Object));
  });

  it("reports partial imports as failures", async () => {
    mergeOrUploadDocuments.mockResolvedValue({ results: [{ succeeded: false }] });
    await expect(seedKnowledgeSamples()).rejects.toThrow("failed to index");
  });

  it("does not seed samples outside DEV", async () => {
    vi.stubEnv("ESP_ENVIRONMENT", "test");
    await expect(seedKnowledgeSamples()).rejects.toThrow("limited to DEV");
    expect(mergeOrUploadDocuments).not.toHaveBeenCalled();
  });
});

describe("managed document indexing", () => {
  it("publishes and removes finance chunks only in the finance index", async () => {
    vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "true");
    vi.resetModules();
    const isolated = await import("./knowledge-search");
    const chunk = { ...knowledgeDocuments.find((document) => document.skillId === "search-expense-policy")!, id: "kb-0123456789abcdef0123456789abcdef-c001", corpus: "esp-dev-managed-v1" as const };
    mergeOrUploadDocuments.mockResolvedValue({ results: [{ succeeded: true }] });
    deleteDocuments.mockResolvedValue({ results: [{ succeeded: true }] });
    await isolated.indexManagedChunks([chunk]);
    await isolated.removeManagedChunks([chunk.id], chunk.skillId);
    expect(constructed.mock.calls.map((call) => call[1])).toEqual(["esp-finance-dev-v1"]);
    await expect(isolated.indexManagedChunks([chunk, { ...chunk, skillId: "search-company-policy" }])).rejects.toThrow("managed knowledge");
  });

  it("does not publish or remove built-in samples through document actions", async () => {
    await expect(indexManagedChunks([knowledgeDocuments[0]])).rejects.toThrow("managed knowledge");
    await expect(removeManagedChunks([knowledgeDocuments[0].id], knowledgeDocuments[0].skillId)).rejects.toThrow("managed chunk");
    expect(mergeOrUploadDocuments).not.toHaveBeenCalled();
    expect(deleteDocuments).not.toHaveBeenCalled();
  });

  it("checks every result of a managed document batch", async () => {
    const chunk = { ...knowledgeDocuments[0], id: "kb-0123456789abcdef0123456789abcdef-c001", corpus: "esp-dev-managed-v1" as const };
    mergeOrUploadDocuments.mockResolvedValue({ results: [{ succeeded: false }] });
    await expect(indexManagedChunks([chunk])).rejects.toThrow("index operation failed");
    deleteDocuments.mockResolvedValue({ results: [{ succeeded: true }] });
    await expect(removeManagedChunks([chunk.id], chunk.skillId)).resolves.toBeUndefined();
    expect(deleteDocuments).toHaveBeenCalledWith("id", [chunk.id], expect.any(Object));
  });
});