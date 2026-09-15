import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareKnowledgeDocument } from "./knowledge-chunks";

const { download, upload, getBlobClient, getBlockBlobClient, listBlobsFlat, byPage } = vi.hoisted(() => ({
  download: vi.fn(), upload: vi.fn(), getBlobClient: vi.fn(), getBlockBlobClient: vi.fn(), listBlobsFlat: vi.fn(), byPage: vi.fn(),
}));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    getContainerClient() { return { getBlobClient, getBlockBlobClient, listBlobsFlat }; }
  },
}));

import { getManagedDocument, listManagedDocuments, writeManagedDocument } from "./knowledge-document-store";

const document = prepareKnowledgeDocument({
  title: "Store test", skillId: "search-expense-policy", documentNumber: "SIM-FIN-TEST-001", owner: "Test team",
  effectiveDate: "2026-09-10", dataKind: "policy", filename: "demo.md", content: "Synthetic document for Blob storage tests.", simulated: true,
}, "kb-0123456789abcdef0123456789abcdef", "development:local", "2026-09-10T10:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount");
  getBlobClient.mockReturnValue({ download }); getBlockBlobClient.mockReturnValue({ upload });
  download.mockImplementation(async () => ({ etag: "v1", readableStreamBody: Readable.from([JSON.stringify(document)]) }));
  upload.mockResolvedValue({ etag: "v2" });
  listBlobsFlat.mockReturnValue({ byPage });
});
afterEach(() => vi.unstubAllEnvs());

describe("knowledge document Blob store", () => {
  it("reads the original document using GET and retains its ETag", async () => {
    expect(await getManagedDocument(document.id)).toEqual({ document, etag: "v1" });
    expect(getBlobClient).toHaveBeenCalledWith(`knowledge/documents/${document.id}.json`);
    expect(download).toHaveBeenCalledWith(0, undefined, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
  });

  it("writes new records only if absent, and updates only at the supplied ETag", async () => {
    await writeManagedDocument(document, null);
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), Buffer.byteLength(JSON.stringify(document)), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    expect(JSON.parse(upload.mock.calls[0][0])).toEqual(document);
    await writeManagedDocument(document, "v1");
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifMatch: "v1" } }));
  });

  it("maps a condition failure to conflict rather than overwriting", async () => {
    upload.mockRejectedValue(Object.assign(new Error("Precondition failed"), { statusCode: 412 }));
    await expect(writeManagedDocument(document, "old")).rejects.toThrow("CONFLICT");
  });

  it("does not hide storage outages or missing containers", async () => {
    const error = Object.assign(new Error("Missing container"), { code: "ContainerNotFound" });
    download.mockRejectedValue(error);
    await expect(getManagedDocument(document.id)).rejects.toBe(error);
    download.mockRejectedValue(Object.assign(new Error("Missing blob"), { code: "BlobNotFound" }));
    expect(await getManagedDocument(document.id)).toBeNull();
  });

  it("detects corrupt chunk content rather than treating it as valid source evidence", async () => {
    download.mockResolvedValue({ etag: "v1", readableStreamBody: Readable.from([JSON.stringify({ ...document, chunks: [{ ...document.chunks[0], content: "changed" }] })]) });
    await expect(getManagedDocument(document.id)).rejects.toThrow("chunk ranges");
  });

  it("returns a bounded page and opaque continuation cursor", async () => {
    byPage.mockReturnValue((async function* () {
      yield { segment: { blobItems: [{ name: `knowledge/documents/${document.id}.json` }] }, continuationToken: "next-cursor" };
    })());
    expect(await listManagedDocuments("current-cursor")).toEqual({ documents: [{ document, etag: "v1" }], nextCursor: "next-cursor" });
    expect(byPage).toHaveBeenCalledWith({ continuationToken: "current-cursor", maxPageSize: 20 });
  });
});