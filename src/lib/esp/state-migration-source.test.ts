import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listBlobsFlat, download } = vi.hoisted(() => ({ listBlobsFlat: vi.fn(), download: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: class { getContainerClient() { return { listBlobsFlat, getBlobClient: (name: string) => ({ download: (...args: unknown[]) => download(name, ...args) }) }; } } }));
import { readBlobStateSnapshot } from "./state-migration-source";
const ticket = { id: "ESP-20260911-11223344", createdBy: "development:local", createdAt: "2026-09-11T00:00:00.000Z", status: "open", summary: "Synthetic legacy ticket" };
let etag = "v1";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount"); etag = "v1";
  listBlobsFlat.mockImplementation(({ prefix }) => (async function* () { if (prefix === "tickets/") yield { name: `tickets/${ticket.id}.json`, properties: { etag } }; })());
  download.mockImplementation(async () => ({ etag, readableStreamBody: Readable.from([JSON.stringify(ticket)]) }));
});
afterEach(() => vi.unstubAllEnvs());
describe("migration source snapshot", () => {
  it("reads known state prefixes without modifying source blobs", async () => {
    const snapshot = await readBlobStateSnapshot(); expect(snapshot.tickets).toEqual([ticket]); expect(snapshot.approvals).toEqual([]);
    await expect(snapshot.assertUnchanged()).resolves.toBeUndefined();
    expect(listBlobsFlat.mock.calls.map(([options]) => options.prefix)).toEqual(["tickets/", "approvals/", "tickets/", "approvals/"]);
  });
  it("detects source changes using Blob ETags", async () => {
    const snapshot = await readBlobStateSnapshot(); etag = "v2";
    await expect(snapshot.assertUnchanged()).rejects.toThrow("STATE_SOURCE_CHANGED");
  });
  it("uses conditional reads for the same ETag with list/header quoting differences", async () => {
    etag = "0x8DF000000000001";
    download.mockImplementation(async () => ({ etag: `"${etag}"`, readableStreamBody: Readable.from([JSON.stringify(ticket)]) }));
    const snapshot = await readBlobStateSnapshot();
    expect(snapshot.tickets).toEqual([ticket]);
    expect(download).toHaveBeenCalledWith(`tickets/${ticket.id}.json`, 0, undefined, expect.objectContaining({ conditions: { ifMatch: '"0x8DF000000000001"' } }));
    await expect(snapshot.assertUnchanged()).resolves.toBeUndefined();
  });
  it("aborts before copying a blob whose version changed after listing", async () => {
    download.mockRejectedValue({ statusCode: 412, code: "ConditionNotMet" });
    await expect(readBlobStateSnapshot()).rejects.toThrow("STATE_SOURCE_CHANGED");
  });
  it("retains the existing exclusion of legacy tickets with no owner", async () => {
    download.mockResolvedValue({ etag, readableStreamBody: Readable.from([JSON.stringify({ ...ticket, createdBy: undefined })]) });
    const snapshot = await readBlobStateSnapshot(); expect(snapshot.tickets).toEqual([]); expect(snapshot.skippedUnownedTickets).toBe(1);
  });
  it("fails on corrupt owned records rather than silently losing state", async () => {
    download.mockResolvedValue({ etag, readableStreamBody: Readable.from([JSON.stringify({ ...ticket, id: "mismatched-id" })]) });
    await expect(readBlobStateSnapshot()).rejects.toThrow("INVALID_STATE_SOURCE_TICKET");
  });
});