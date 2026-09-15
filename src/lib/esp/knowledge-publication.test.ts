import { describe, expect, it, vi } from "vitest";
import { prepareKnowledgeDocument } from "./knowledge-chunks";
import { changeKnowledgePublication, searchChunks, type PublicationDependencies } from "./knowledge-publication";
import type { StoredDocument } from "./knowledge-library-contracts";

const id = "kb-0123456789abcdef0123456789abcdef";
const draft = prepareKnowledgeDocument({
  title: "Demo procedure", skillId: "search-expense-policy", documentNumber: "SIM-FIN-DEMO-001",
  owner: "Demo team", effectiveDate: "2026-09-10", dataKind: "policy", filename: "demo.txt",
  content: "Demo policy text with a 25 unit meal limit.", simulated: true,
}, id, "development:local", "2026-09-10T10:00:00.000Z");

function setup() {
  let current: StoredDocument = { document: structuredClone(draft), etag: "v1" };
  let revision = 1;
  const dependencies: PublicationDependencies = {
    get: vi.fn(async () => current),
    write: vi.fn(async (document, etag) => {
      if (etag !== current.etag) throw new Error("ETag mismatch");
      current = { document, etag: `v${++revision}` };
      return current;
    }),
    upsert: vi.fn(async () => {}), remove: vi.fn(async () => {}),
    now: () => "2026-09-10T11:00:00.000Z",
  };
  return { dependencies, current: () => current };
}

describe("knowledge publication lifecycle", () => {
  it("indexes exact chunks and only then marks a draft published", async () => {
    const { dependencies, current } = setup();
    dependencies.upsert = vi.fn(async (chunks) => {
      expect(current().document.status).toBe("indexing");
      expect(chunks).toEqual(searchChunks(draft));
    });
    const result = await changeKnowledgePublication(id, "publish", "v1", dependencies);
    expect(result.document.status).toBe("published");
    expect(result.document.lastError).toBeUndefined();
    expect(result.etag).toBe("v3");
  });

  it("makes failed publication visible and permits retry", async () => {
    const { dependencies } = setup();
    dependencies.upsert = vi.fn().mockRejectedValueOnce(new Error("Partial index failure")).mockResolvedValue(undefined);
    const failed = await changeKnowledgePublication(id, "publish", "v1", dependencies);
    expect(failed.document).toMatchObject({ status: "error", lastError: "INDEX_PUBLISH_FAILED" });
    const retry = await changeKnowledgePublication(id, "publish", failed.etag, dependencies);
    expect(retry.document.status).toBe("published");
  });

  it("withdraws visibility before search cleanup, even when cleanup fails", async () => {
    const { dependencies, current } = setup();
    const published = await changeKnowledgePublication(id, "publish", "v1", dependencies);
    dependencies.remove = vi.fn(async () => {
      expect(current().document.status).not.toBe("published");
      throw new Error("Search cleanup unavailable");
    });
    const result = await changeKnowledgePublication(id, "deactivate", published.etag, dependencies);
    expect(result.document).toMatchObject({ status: "inactive", lastError: "INDEX_CLEANUP_FAILED" });
  });

  it("rejects stale pages without writing or changing the index", async () => {
    const { dependencies } = setup();
    await expect(changeKnowledgePublication(id, "publish", "old-etag", dependencies)).rejects.toThrow("CONFLICT");
    expect(dependencies.write).not.toHaveBeenCalled();
    expect(dependencies.upsert).not.toHaveBeenCalled();
  });

  it("does not allow simultaneous operations", async () => {
    const { dependencies } = setup();
    dependencies.get = vi.fn(async (): Promise<StoredDocument> => ({ document: { ...draft, status: "indexing", updatedAt: dependencies.now() }, etag: "v1" }));
    await expect(changeKnowledgePublication(id, "publish", "v1", dependencies)).rejects.toThrow("BUSY");
  });

  it("can recover an abandoned indexing state after its bounded operation window", async () => {
    const { dependencies, current } = setup();
    current().document.status = "indexing";
    const result = await changeKnowledgePublication(id, "publish", "v1", dependencies);
    expect(result.document.status).toBe("published");
  });

  it("returns not found for unknown documents", async () => {
    const { dependencies } = setup();
    dependencies.get = vi.fn().mockResolvedValue(null);
    await expect(changeKnowledgePublication(id, "publish", "v1", dependencies)).rejects.toThrow("NOT_FOUND");
  });
});