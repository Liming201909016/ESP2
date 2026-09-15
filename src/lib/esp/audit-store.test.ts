import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditResult, AuditStart } from "./audit-contracts";
import type { IdentityContext } from "./identity";

const { upload, download, getBlobClient, getBlockBlobClient, byPage, listBlobsFlat } = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), getBlobClient: vi.fn(), getBlockBlobClient: vi.fn(), byPage: vi.fn(), listBlobsFlat: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: class { getContainerClient() { return { getBlobClient, getBlockBlobClient, listBlobsFlat }; } } }));
import { auditWriter, getAudit, listAudit } from "./audit-store";

const identity: IdentityContext = { authenticated: true, subject: "development:local", displayName: "DEV", source: "development", permissions: ["tickets.create"] };
const start: AuditStart = {
  schemaVersion: 1, id: `aud-8210900000000-${"a".repeat(32)}`, requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", traceId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  kind: "approval_action", action: "approval.approve", actor: { subject: identity.subject!, source: "development", permissions: identity.permissions },
  startedAt: "2026-09-11T02:00:00.000Z", mutation: true, input: { fields: [] }, requiredPermissions: ["tickets.create"], references: [{ type: "approval", id: `apr-${"c".repeat(32)}` }],
};
const result: AuditResult = { schemaVersion: 1, id: start.id, requestId: start.requestId, traceId: start.traceId, status: "approved", httpStatus: 200, requiredPermissions: ["tickets.create"], references: start.references, trace: [{ step: "approval.approved", at: start.startedAt }], completedAt: "2026-09-11T02:00:01.000Z", durationMs: 1_000 };
const root = `execution-audit/${createHash("sha256").update(identity.subject!).digest("hex")}/`;
const files = new Map<string, unknown>();

beforeEach(() => {
  vi.resetAllMocks(); files.clear(); vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount");
  files.set(`${root}starts/${start.id}.json`, start); files.set(`${root}results/${start.id}.json`, result);
  getBlobClient.mockImplementation((path: string) => ({ download: (...args: unknown[]) => download(path, ...args) }));
  download.mockImplementation(async (path: string) => { if (!files.has(path)) throw { code: "BlobNotFound" }; return { readableStreamBody: Readable.from([JSON.stringify(files.get(path))]) }; });
  getBlockBlobClient.mockReturnValue({ upload });
  listBlobsFlat.mockReturnValue({ byPage });
  byPage.mockImplementation(() => (async function* () { yield { segment: { blobItems: [{ name: `${root}starts/${start.id}.json` }] }, continuationToken: "next" }; })());
});
afterEach(() => vi.unstubAllEnvs());

describe("append-only audit storage", () => {
  it("writes separate create-only start and result files under a hashed owner prefix", async () => {
    await auditWriter.begin(start); await auditWriter.finish(result, identity.subject!);
    expect(getBlockBlobClient.mock.calls.map(([path]) => path)).toEqual([`${root}starts/${start.id}.json`, `${root}results/${start.id}.json`]);
    for (const call of upload.mock.calls) expect(call[2]).toMatchObject({ conditions: { ifNoneMatch: "*" } });
    expect(getBlockBlobClient.mock.calls[0][0]).not.toContain(identity.subject!);
  });
  it("accepts only identical retries and never overwrites an existing audit", async () => {
    upload.mockRejectedValue({ code: "BlobAlreadyExists" });
    await expect(auditWriter.begin(start)).resolves.toBeUndefined();
    await expect(auditWriter.begin({ ...start, action: "changed" })).rejects.toThrow("different content");
  });
  it("returns exact identity-scoped records and marks absent results as incomplete", async () => {
    expect(await getAudit(start.id, identity)).toEqual({ start, result });
    files.delete(`${root}results/${start.id}.json`);
    expect(await getAudit(start.id, identity)).toEqual({ start, result: null });
  });
  it("does not expose another owner or records after required permissions are removed", async () => {
    expect(await getAudit(start.id, { ...identity, subject: "another-user" })).toBeNull();
    expect(await getAudit(start.id, { ...identity, permissions: ["knowledge.read"] })).toBeNull();
    await expect(getAudit(start.id, { ...identity, authenticated: false })).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });
  it("checks result permissions as well as start permissions", async () => {
    files.set(`${root}starts/${start.id}.json`, { ...start, requiredPermissions: [] });
    expect(await getAudit(start.id, { ...identity, permissions: ["knowledge.read"] })).toBeNull();
  });
  it("treats corrupt and mismatched results as service failures, not missing business evidence", async () => {
    files.set(`${root}results/${start.id}.json`, { ...result, requestId: "cccccccc-cccc-4ccc-accc-cccccccccccc" });
    await expect(getAudit(start.id, identity)).rejects.toThrow("Invalid stored audit result");
    download.mockRejectedValue({ code: "ContainerNotFound" });
    await expect(getAudit(start.id, identity)).rejects.toEqual({ code: "ContainerNotFound" });
  });
  it("keeps pagination bounded and preserves cursors when a filter yields no records", async () => {
    expect(await listAudit(identity, { traceId: start.traceId, cursor: "current" })).toEqual({ records: [{ start, result }], nextCursor: "next" });
    expect(byPage).toHaveBeenCalledWith({ continuationToken: "current", maxPageSize: 20 });
    expect((await listAudit(identity, { reference: `approval:apr-${"c".repeat(32)}` })).records).toHaveLength(1);
    expect(await listAudit(identity, { traceId: "dddddddd-dddd-4ddd-addd-dddddddddddd" })).toEqual({ records: [], nextCursor: "next" });
  });
  it("rejects invalid identifiers without fetching other paths", async () => {
    expect(await getAudit("../../private", identity)).toBeNull(); expect(download).not.toHaveBeenCalled();
    await expect(listAudit(identity, { reference: "ticket:../../private" })).rejects.toThrow();
  });
});