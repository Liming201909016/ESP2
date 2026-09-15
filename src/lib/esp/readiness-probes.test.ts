import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeDocuments } from "./knowledge-corpus";

const { getProperties, getDocument, query, getContainerClient } = vi.hoisted(() => ({ getProperties: vi.fn(), getDocument: vi.fn(), query: vi.fn(), getContainerClient: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: class { getContainerClient = getContainerClient; } }));
vi.mock("@azure/search-documents", () => ({ SearchClient: class { getDocument = getDocument; } }));
vi.mock("./postgres", () => ({ postgresSql: { query } }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount");
  vi.stubEnv("AZURE_SEARCH_ENDPOINT", "https://example.search.windows.net");
  vi.stubEnv("ESP_STATE_BACKEND", "postgres");
  vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "false");
  getContainerClient.mockReturnValue({ getProperties });
  getProperties.mockResolvedValue({});
  getDocument.mockResolvedValue(knowledgeDocuments[0]);
  query.mockResolvedValue({ rows: [{ ready: 1 }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("read-only readiness adapters", () => {
  it("checks both indexes when finance is enabled and fails on a wrong finance sentinel", async () => {
    vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "true");
    getDocument.mockImplementation(async (id: string) => knowledgeDocuments.find((document) => document.id === id));
    const { dependencyReadiness } = await import("./readiness-probes");
    expect((await dependencyReadiness()).status).toBe("ready");
    expect(getDocument).toHaveBeenCalledTimes(2);
    vi.resetModules();
    getDocument.mockResolvedValue(knowledgeDocuments[0]);
    const other = await import("./readiness-probes");
    expect((await other.dependencyReadiness()).checks.search.status).toBe("unavailable");
  });

  it("does no dependency IO on module import and uses only bounded reads when requested", async () => {
    const { dependencyReadiness } = await import("./readiness-probes");
    expect(getProperties).not.toHaveBeenCalled(); expect(getDocument).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    expect((await dependencyReadiness()).status).toBe("ready");
    expect(getContainerClient).toHaveBeenCalledWith("audit");
    expect(getProperties).toHaveBeenCalledWith({ abortSignal: expect.any(AbortSignal) });
    expect(getDocument).toHaveBeenCalledWith(knowledgeDocuments[0].id, { abortSignal: expect.any(AbortSignal) });
    expect(query).toHaveBeenCalledExactlyOnceWith("SELECT 1 AS ready");
  });

  it.each(["version", "content", "corpus"])("fails readiness for a mismatched Search sentinel %s", async (field) => {
    getDocument.mockResolvedValue({ ...knowledgeDocuments[0], [field]: "unexpected" });
    const { dependencyReadiness } = await import("./readiness-probes");
    const result = await dependencyReadiness();
    expect(result.status).toBe("degraded"); expect(result.checks.search.status).toBe("unavailable");
  });

  it("distinguishes missing configuration and a non-selected SQL backend", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT", ""); vi.stubEnv("AZURE_SEARCH_ENDPOINT", ""); vi.stubEnv("ESP_STATE_BACKEND", "blob");
    const { dependencyReadiness } = await import("./readiness-probes");
    expect(await dependencyReadiness()).toMatchObject({ status: "degraded", model: "not_probed", checks: { blob: { status: "not_configured" }, search: { status: "not_configured" }, state: { status: "not_required" } } });
    expect(getProperties).not.toHaveBeenCalled(); expect(getDocument).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });

  it("redacts SDK and SQL error details and caches the failure", async () => {
    getProperties.mockRejectedValue(new Error("private endpoint and token"));
    query.mockRejectedValue(new Error("private SQL connection string"));
    const { dependencyReadiness } = await import("./readiness-probes");
    const first = await dependencyReadiness(); const second = await dependencyReadiness();
    expect(second).toEqual(first); expect(first.status).toBe("degraded");
    expect(JSON.stringify(first)).not.toMatch(/private|token|SQL|connection/);
    expect(getProperties).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(1);
  });
});