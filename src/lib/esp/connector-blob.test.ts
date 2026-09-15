import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { download, getProperties, upload, byPage, getBlobClient, getBlockBlobClient, listBlobsFlat } = vi.hoisted(() => ({ download: vi.fn(), getProperties: vi.fn(), upload: vi.fn(), byPage: vi.fn(), getBlobClient: vi.fn(), getBlockBlobClient: vi.fn(), listBlobsFlat: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: class { getContainerClient() { return { getBlobClient, getBlockBlobClient, listBlobsFlat }; } } }));
import { getConnectorState, listConnectorSourceIds, readConnectorSource, seedConnectorExamples, verifyConnectorSource, writeConnectorState } from "./connector-blob";
import { connectorExamples, connectorExampleFiles } from "./connector-examples";
import type { ConnectorState } from "./connector-contracts";

const content = Buffer.from("# Simulation\n\nConnector transport support is 37 test credits.");
const metadata = { title: "Synthetic rule", skillId: "search-expense-policy", documentNumber: "SIM-FIN-BLOB-001", owner: "QA", effectiveDate: "2026-09-11", dataKind: "policy", filename: "policy.md", simulated: true, contentSha256: createHash("sha256").update(content).digest("hex") };
const modified = new Date("2026-09-11T00:00:00.000Z");
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount");
  getBlobClient.mockImplementation((path) => ({ download: (...args: unknown[]) => download(path, ...args), getProperties: (options: unknown) => getProperties(path, options) }));
  getBlockBlobClient.mockReturnValue({ upload }); listBlobsFlat.mockReturnValue({ byPage });
  download.mockImplementation(async (path: string) => ({ readableStreamBody: Readable.from([path.endsWith("manifest.json") ? Buffer.from(JSON.stringify(metadata)) : content]), etag: '"v1"', lastModified: modified }));
  getProperties.mockResolvedValue({ etag: '"v1"' }); upload.mockResolvedValue({ etag: '"v2"' });
});
afterEach(() => vi.unstubAllEnvs());

describe("private Blob knowledge source", () => {
  it("creates only missing example files, with manifests written after exact text bytes", async () => {
    getProperties.mockRejectedValue({ statusCode: 404 }); download.mockRejectedValue({ code: "BlobNotFound", statusCode: 404 });
    const result = await seedConnectorExamples();
    expect(result.examples.map((example) => example.outcome)).toEqual(Array(connectorExamples.length).fill("created"));
    expect(getProperties).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(connectorExamples.length * 2);
    for (const call of upload.mock.calls) expect(call[2].conditions).toEqual({ ifNoneMatch: "*" });
    const paths = getBlockBlobClient.mock.calls.map(([path]) => path);
    expect(paths[0]).toBe("connector-sources/knowledge/sim-hr-rotation/rotation.md");
    expect(paths[1]).toBe("connector-sources/knowledge/sim-hr-rotation/manifest.json");
    for (const example of connectorExamples) {
      const files = connectorExampleFiles(example);
      expect(files.manifest.contentSha256).toBe(createHash("sha256").update(files.content).digest("hex"));
    }
  });
  it("never replaces a source that already has a manifest", async () => {
    const result = await seedConnectorExamples();
    expect(result.examples.every((example) => example.outcome === "existing")).toBe(true);
    expect(upload).not.toHaveBeenCalled(); expect(download).toHaveBeenCalledTimes(connectorExamples.length); expect(getProperties).not.toHaveBeenCalled();
  });
  it.each(["ContainerNotFound", "AuthorizationFailure"])("does not initialize sources after %s", async (code) => {
    download.mockRejectedValue({ code, statusCode: code === "ContainerNotFound" ? 404 : 403 });
    const result = await seedConnectorExamples();
    expect(result.executionStatus).toBe("failed"); expect(result.examples.every((example) => example.error === "EXAMPLE_SOURCE_UNAVAILABLE")).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });
  it("does not attach a new manifest to different pre-existing content", async () => {
    download.mockImplementation(async (path: string) => {
      if (path.endsWith("manifest.json")) throw { code: "BlobNotFound" };
      return { readableStreamBody: Readable.from([content]), etag: '"v1"', lastModified: modified };
    });
    upload.mockRejectedValue({ code: "BlobAlreadyExists" });
    const result = await seedConnectorExamples();
    expect(result.executionStatus).toBe("failed"); expect(result.examples.every((example) => example.error === "EXAMPLE_SOURCE_CONFLICT")).toBe(true);
    expect(getBlockBlobClient.mock.calls.some(([path]) => path.endsWith("manifest.json"))).toBe(false);
  });

  it("reads a verified snapshot and checks both ETags after reading", async () => {
    const source = await readConnectorSource("sim-transit");
    expect(source.input.content).toBe(content.toString()); expect(source.bytes).toBe(content.byteLength);
    expect(source.chunks.map((chunk) => chunk.content).join("")).toBe(source.input.content);
    expect(getProperties).toHaveBeenCalledWith("connector-sources/knowledge/sim-transit/manifest.json", expect.objectContaining({ conditions: { ifMatch: '"v1"' } }));
    expect(getProperties).toHaveBeenCalledWith("connector-sources/knowledge/sim-transit/policy.md", expect.objectContaining({ conditions: { ifMatch: '"v1"' } }));
  });
  it("does not report a missing container as a missing source", async () => {
    download.mockRejectedValue({ code: "ContainerNotFound" }); await expect(readConnectorSource("sim-transit")).rejects.toThrow("CONNECTOR_STORAGE_UNAVAILABLE");
    download.mockRejectedValue({ code: "BlobNotFound" }); await expect(readConnectorSource("sim-transit")).rejects.toThrow("SOURCE_NOT_FOUND");
  });
  it("blocks changed snapshots before synchronization", async () => {
    const source = await readConnectorSource("sim-transit"); getProperties.mockRejectedValue({ statusCode: 412 });
    await expect(verifyConnectorSource(source)).rejects.toThrow("SOURCE_CHANGED");
  });
  it("bounds actual streamed bytes even when content length is absent", async () => {
    download.mockImplementation(async (path: string) => ({ readableStreamBody: Readable.from([path.endsWith("manifest.json") ? Buffer.from(JSON.stringify(metadata)) : Buffer.alloc(160_001)]), etag: '"v1"', lastModified: modified }));
    await expect(readConnectorSource("sim-transit")).rejects.toThrow("SOURCE_TOO_LARGE");
  });
  it("returns one bounded manifest page without following arbitrary blob names", async () => {
    byPage.mockReturnValue((async function* () { yield { segment: { blobItems: [{ name: "connector-sources/knowledge/sim-transit/manifest.json" }, { name: "connector-sources/knowledge/sim-transit/policy.md" }, { name: "tickets/manifest.json" }] }, continuationToken: "next" }; })());
    expect(await listConnectorSourceIds("current")).toEqual({ ids: ["sim-transit"], nextCursor: "next" });
    expect(byPage).toHaveBeenCalledWith({ continuationToken: "current", maxPageSize: 20 });
    expect(download).not.toHaveBeenCalled();
  });
  it("creates and updates sync records conditionally", async () => {
    const record: ConnectorState = { connectorId: "blob-knowledge", sourceId: "sim-transit", status: "idle", updatedAt: modified.toISOString(), lastSuccess: null, activeRun: null, history: [] };
    await writeConnectorState(record, null);
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    await writeConnectorState(record, '"v1"');
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifMatch: '"v1"' } }));
    upload.mockRejectedValue({ statusCode: 412 }); await expect(writeConnectorState(record, '"old"')).rejects.toThrow("SYNC_CONFLICT");
  });
  it("returns null only for a missing sync record", async () => {
    download.mockRejectedValue({ code: "BlobNotFound" }); expect(await getConnectorState("sim-transit")).toBeNull();
    download.mockRejectedValue({ code: "AuthorizationFailure" }); await expect(getConnectorState("sim-transit")).rejects.toThrow("CONNECTOR_STORAGE_UNAVAILABLE");
  });
});