import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConnectorError, connectorDocumentId, connectorSnapshot, parseConnectorManifest } from "./connector-source";
import { connectorDetails, syncConnectorSource, type ConnectorSyncDependencies } from "./connector-sync";
import { connectorSyncResponseSchema, type ConnectorSource, type ConnectorSyncRequest, type StoredConnectorState } from "./connector-contracts";
import { chunkKnowledgeText } from "./knowledge-chunks";
import { KnowledgeDocumentError } from "./knowledge-document-store";
import type { StoredDocument } from "./knowledge-library-contracts";

function sourceFor(content = "Synthetic support policy: transit support is 37 test credits."): ConnectorSource {
  const bytes = Buffer.from(content);
  const metadata = parseConnectorManifest(Buffer.from(JSON.stringify({ title: "Synthetic support policy", skillId: "search-expense-policy", documentNumber: "SIM-FIN-SYNC-001", owner: "Simulation finance", effectiveDate: "2026-09-11", dataKind: "policy", filename: "policy.md", simulated: true, contentSha256: createHash("sha256").update(bytes).digest("hex") })));
  const snapshot = connectorSnapshot(metadata, bytes);
  const documentId = connectorDocumentId("testaccount", "sim-transit", snapshot.fingerprint);
  return { id: "sim-transit", metadata, ...snapshot, documentId, bytes: bytes.byteLength, modifiedAt: "2026-09-11T00:00:00.000Z", manifestEtag: '"m1"', contentEtag: '"c1"', chunks: chunkKnowledgeText(documentId, snapshot.input.content) };
}

function setup() {
  const documents = new Map<string, StoredDocument>();
  let state: StoredConnectorState | null = null;
  let revision = 0;
  const source = sourceFor();
  const dependencies: ConnectorSyncDependencies = {
    source: vi.fn(async () => source), verify: vi.fn(async () => undefined), state: vi.fn(async () => state),
    writeState: vi.fn(async (record, etag) => {
      if ((state?.etag ?? null) !== etag) throw new ConnectorError("SYNC_CONFLICT", 409);
      state = { record: structuredClone(record), etag: `v${++revision}` }; return state;
    }),
    document: vi.fn(async (id) => documents.get(id) ?? null),
    writeDocument: vi.fn(async (document) => {
      if (documents.has(document.id)) throw new KnowledgeDocumentError("CONFLICT");
      const stored = { document: structuredClone(document), etag: "doc-v1" }; documents.set(document.id, stored); return stored;
    }), now: () => "2026-09-11T00:00:00.000Z",
  };
  const request = (detail: Awaited<ReturnType<typeof connectorDetails>>): ConnectorSyncRequest => ({ action: "sync", manifestEtag: detail.source!.manifestEtag, contentEtag: detail.source!.contentEtag, fingerprint: detail.source!.fingerprint, stateEtag: detail.stateEtag });
  const detail = () => connectorDetails("sim-transit", true, dependencies);
  const sync = async () => syncConnectorSource("sim-transit", request(await detail()), "development:local", dependencies);
  return { dependencies, source, documents, detail, request, sync };
}

describe("Blob source to knowledge draft synchronization", () => {
  it("creates a draft with exact provenance and never publishes it", async () => {
    const { sync, source, documents } = setup();
    const result = connectorSyncResponseSchema.parse(await sync());
    expect(result.sync.outcome).toBe("created"); expect(documents.size).toBe(1);
    expect(result.detail.document?.entry.status).toBe("draft");
    expect(result.detail.document?.content).toBe(source.input.content);
    expect(result.detail.document?.provenance).toMatchObject({ connectorId: "blob-knowledge", sourceId: source.id, fingerprint: source.fingerprint, manifestEtag: source.manifestEtag });
    expect(result.detail.state?.history[0].outcome).toBe("created");
  });
  it("reuses the same snapshot without resetting publication or deactivation", async () => {
    const { sync, source, documents, dependencies } = setup(); await sync();
    documents.get(source.documentId)!.document.status = "published";
    expect((await sync()).detail.document?.entry.status).toBe("published");
    documents.get(source.documentId)!.document.status = "inactive";
    const result = await sync(); expect(result.sync.outcome).toBe("reused"); expect(result.detail.document?.entry.status).toBe("inactive");
    expect(dependencies.writeDocument).toHaveBeenCalledTimes(1); expect(documents.size).toBe(1);
  });
  it("imports changed source content as another draft without overwriting the previous published version", async () => {
    const { sync, source, documents, dependencies, detail } = setup(); await sync();
    documents.get(source.documentId)!.document.status = "published";
    const updated = { ...sourceFor("Synthetic revised transit support is 41 test credits per trip."), manifestEtag: '"m2"', contentEtag: '"c2"' };
    dependencies.source = async () => updated;
    expect((await detail()).change).toBe("changed");
    const result = await sync(); expect(result.sync.outcome).toBe("created"); expect(documents.size).toBe(2);
    expect(result.detail.document?.entry.status).toBe("draft"); expect(documents.get(source.documentId)?.document.status).toBe("published");
  });
  it("rejects stale source and state versions before creating a draft", async () => {
    const { dependencies, detail, request, sync } = setup(); const previous = await detail();
    await expect(syncConnectorSource("sim-transit", { ...request(previous), contentEtag: '"stale"' }, "development:local", dependencies)).rejects.toThrow("SOURCE_CHANGED");
    await sync(); await expect(syncConnectorSource("sim-transit", request(previous), "development:local", dependencies)).rejects.toThrow("SYNC_CONFLICT");
    expect(dependencies.writeDocument).toHaveBeenCalledTimes(1);
  });
  it("allows only one concurrent synchronization at the source state lock", async () => {
    const { dependencies, detail, request, documents } = setup(); const input = request(await detail());
    const results = await Promise.allSettled([syncConnectorSource("sim-transit", input, "development:local", dependencies), syncConnectorSource("sim-transit", input, "development:local", dependencies)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(documents.size).toBe(1);
  });
  it("retains a recoverable error without claiming draft success when storage fails", async () => {
    const { dependencies, sync } = setup(); dependencies.writeDocument = vi.fn(async () => { throw new Error("Private storage detail"); });
    const result = await sync(); expect(result.executionStatus).toBe("failed"); expect(result.detail.state?.lastError).toBe("SYNC_DRAFT_UNCONFIRMED");
    expect(result.detail.document).toBeNull(); expect(JSON.stringify(result)).not.toContain("Private storage detail");
  });
  it("rechecks source versions after acquiring the sync lock", async () => {
    const { dependencies, sync } = setup(); dependencies.verify = vi.fn(async () => { throw new ConnectorError("SOURCE_CHANGED", 409); });
    const result = await sync(); expect(result.sync.error).toBe("SOURCE_CHANGED"); expect(dependencies.writeDocument).not.toHaveBeenCalled();
  });
  it("recovers a lost final state write by reusing the deterministic draft after the lease", async () => {
    const { dependencies, sync, detail, documents } = setup(); const write = dependencies.writeState;
    dependencies.writeState = async (record, etag) => { if (record.status === "idle") throw new Error("Final state failed"); return write(record, etag); };
    await expect(sync()).rejects.toThrow("Final state failed"); expect(documents.size).toBe(1);
    expect((await detail()).canSync).toBe(false); await expect(sync()).rejects.toThrow("SYNC_BUSY");
    dependencies.writeState = write; dependencies.now = () => "2026-09-11T00:02:00.000Z";
    const result = await sync(); expect(result.sync.outcome).toBe("reused"); expect(documents.size).toBe(1);
    expect(result.detail.state?.history.some((run) => run.error === "SYNC_INTERRUPTED")).toBe(true);
  });
  it("keeps the last synced record inspectable if the source disappears", async () => {
    const { sync, dependencies, detail, source } = setup(); await sync();
    dependencies.source = async () => { throw new ConnectorError("SOURCE_NOT_FOUND", 404); };
    const current = await detail(); expect(current.change).toBe("unavailable"); expect(current.canSync).toBe(false);
    expect(current.document?.entry.id).toBe(source.documentId); expect(current.state?.history).toHaveLength(1);
  });
  it("rejects a different target document even when its ID collides", async () => {
    const { sync, source, documents, dependencies, request, detail } = setup(); const before = await detail();
    await sync(); const stored = documents.get(source.documentId)!; stored.document.title = "Modified outside the connector";
    await expect(detail()).rejects.toThrow("SYNC_TARGET_CONFLICT");
    const state = await dependencies.state(source.id);
    const result = await syncConnectorSource(source.id, { ...request(before), stateEtag: state!.etag }, "development:local", dependencies);
    expect(result.executionStatus).toBe("failed"); expect(result.sync.error).toBe("SYNC_TARGET_CONFLICT");
    expect(stored.document.title).toBe("Modified outside the connector"); expect(dependencies.writeDocument).toHaveBeenCalledTimes(1);
  });
  it("bounds recent sync history without generating duplicate documents", async () => {
    const { sync, detail, documents } = setup();
    for (let count = 0; count < 22; count += 1) await sync();
    expect((await detail()).state?.history).toHaveLength(20); expect(documents.size).toBe(1);
  });
});