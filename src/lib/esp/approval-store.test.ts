import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "./approval-contracts";

const { download, upload, getBlobClient, getBlockBlobClient, byPage } = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn(), getBlobClient: vi.fn(), getBlockBlobClient: vi.fn(), byPage: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: class { getContainerClient() { return { getBlobClient, getBlockBlobClient, listBlobsFlat: () => ({ byPage }) }; } } }));
import { getApproval, listApprovals, writeApproval } from "./approval-store";

const record: ApprovalRecord = {
  id: `apr-${"a".repeat(32)}`, skillId: "create-it-ticket", createdBy: "development:local", query: "Simulated team outage",
  parameters: { description: "Simulated team outage", impact: "team" }, requestHash: "b".repeat(64),
  policy: { policyId: "dev-ticket-impact-review", version: "1.0.0", ruleId: "team-approval", effect: "approval", reason: "Review team impact" },
  status: "pending", createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", expiresAt: "2026-09-12T00:00:00.000Z",
  events: [{ action: "submitted", actor: "development:local", at: "2026-09-11T00:00:00.000Z" }],
};
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount");
  getBlobClient.mockReturnValue({ download }); getBlockBlobClient.mockReturnValue({ upload });
  download.mockImplementation(async () => ({ etag: "v1", readableStreamBody: Readable.from([JSON.stringify(record)]) }));
  upload.mockResolvedValue({ etag: "v2" });
});
afterEach(() => vi.unstubAllEnvs());

describe("approval Blob persistence", () => {
  it("reads the exact record and ETag", async () => {
    expect(await getApproval(record.id)).toEqual({ record, etag: "v1" });
    expect(getBlobClient).toHaveBeenCalledWith(`approvals/${record.id}.json`);
  });
  it("uses conditional creation and ETag updates", async () => {
    await writeApproval(record, null);
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    expect(JSON.parse(upload.mock.calls[0][0])).toEqual(record);
    await writeApproval(record, "v1");
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifMatch: "v1" } }));
  });
  it("maps only precondition collisions to conflict", async () => {
    upload.mockRejectedValue(Object.assign(new Error("Conflict"), { statusCode: 412 }));
    await expect(writeApproval(record, "old")).rejects.toThrow("CONFLICT");
    const error = new Error("Outage"); upload.mockRejectedValue(error);
    await expect(writeApproval(record, "v1")).rejects.toBe(error);
  });
  it("does not confuse missing blobs with missing containers", async () => {
    download.mockRejectedValue({ code: "BlobNotFound" }); expect(await getApproval(record.id)).toBeNull();
    download.mockRejectedValue({ code: "ContainerNotFound" }); await expect(getApproval(record.id)).rejects.toEqual({ code: "ContainerNotFound" });
  });
  it("rejects a mismatched record ID or missing ETag", async () => {
    await expect(getApproval(`apr-${"c".repeat(32)}`)).rejects.toThrow("Invalid stored approval");
    download.mockResolvedValue({ readableStreamBody: Readable.from([JSON.stringify(record)]) });
    await expect(getApproval(record.id)).rejects.toThrow("Incomplete approval response");
  });
  it("returns one owner-filtered page and preserves its cursor even if empty", async () => {
    byPage.mockImplementation(() => (async function* () { yield { segment: { blobItems: [{ name: `approvals/${record.id}.json` }] }, continuationToken: "next" }; })());
    expect(await listApprovals("another-user", "current")).toEqual({ approvals: [], nextCursor: "next" });
    expect(byPage).toHaveBeenCalledWith({ continuationToken: "current", maxPageSize: 20 });
    expect((await listApprovals(record.createdBy)).approvals).toHaveLength(1);
  });
});