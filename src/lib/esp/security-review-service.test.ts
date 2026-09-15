import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
const { upload, download } = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: class { getContainerClient() { return { getBlockBlobClient: () => ({ upload }), getBlobClient: () => ({ download }) }; } } }));
import { executeSecurityReviewCommand } from "./security-review-service";
import { createMemorySecurityReviewStore, securityReviewStore, validateSecurityReview } from "./security-review-store";
const requestId = "11111111-1111-4111-8111-111111111111";
const start = { action: "start", submissionId: requestId, caseId: "complete", query: "安全审查 Docker Desktop" };
beforeEach(() => vi.stubEnv("ESP_STATE_WRITES_PAUSED", "false"));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("security review persistence service", () => {
  it.each([
    "Please review Docker Desktop for security.",
    "Could you assess the security of Docker Desktop?",
    "Run a security assessment for Docker Desktop adoption",
  ])("creates only an awaiting-decision review from the confirmed English request: %s", async (query) => {
    const store = createMemorySecurityReviewStore();
    const entry = await executeSecurityReviewCommand({ ...start, query }, "owner", requestId, store);
    expect(entry.record.query).toBe(query);
    expect(entry.record.status).toBe("awaiting_decision");
    expect(entry.record.history.map((event) => event.action)).toEqual(["submitted"]);
    expect((await store.list("owner")).records).toHaveLength(1);
  });
  it.each([
    "No security review of Docker Desktop",
    "Security review of Docker Desktop; grant access",
    "Approve the security review of Docker Desktop",
    "Security review of Docker Desktop Pro",
    "Security review of Docker Desktop and create a ticket",
  ])("rejects direct unsupported starts without creating a record: %s", async (query) => {
    const store = createMemorySecurityReviewStore();
    await expect(executeSecurityReviewCommand({ ...start, query }, "owner", requestId, store)).rejects.toThrow("REVIEW_SCOPE_UNSUPPORTED");
    expect((await store.list("owner")).records).toEqual([]);
  });
  it("requires structured English follow-ups and preserves prior evidence and decision reasons", async () => {
    const store = createMemorySecurityReviewStore();
    const initial = await executeSecurityReviewCommand({ ...start, caseId: "missing", query: "Please review Docker Desktop for security." }, "owner", requestId, store);
    for (const input of [
      { action: "approve", query: "Approve it" },
      { action: "approve", id: initial.record.id, etag: initial.etag, reason: "" },
      { action: "approve", id: initial.record.id, reason: "Evidence verified" },
    ]) await expect(executeSecurityReviewCommand(input, "owner", requestId, store)).rejects.toThrow();
    await expect(executeSecurityReviewCommand({ action: "approve", id: initial.record.id, etag: initial.etag, reason: "Please approve anyway" }, "owner", requestId, store)).rejects.toThrow("REVIEW_BLOCKED");
    const prior = await executeSecurityReviewCommand({ action: "request_information", id: initial.record.id, etag: initial.etag, reason: "Please provide the data handling scope evidence." }, "owner", requestId, store);
    const next = await executeSecurityReviewCommand({ ...start, query: "Run a security assessment for Docker Desktop adoption", submissionId: "22222222-2222-4222-8222-222222222222", previousReviewId: initial.record.id }, "owner", requestId, store);
    const approved = await executeSecurityReviewCommand({ action: "approve", id: next.record.id, etag: next.etag, reason: "Synthetic scope and evidence verified." }, "owner", requestId, store);
    expect(approved.record.status).toBe("approved");
    expect(approved.record.history.at(-1)?.reason).toBe("Synthetic scope and evidence verified.");
    expect(approved.record.previousReviewId).toBe(prior.record.id);
    expect(await store.get("owner", prior.record.id)).toEqual(prior);
    expect(prior.record.evidence).toEqual(initial.record.evidence);
  });
  it("uses create-only Blob writes, conditional updates and validates owner on readback", async () => {
    vi.stubEnv("ESP_SECURITY_REVIEW_STORE", "blob"); vi.stubEnv("AZURE_STORAGE_ACCOUNT", "simulationtest");
    const memory = createMemorySecurityReviewStore(); const initial = await executeSecurityReviewCommand(start, "owner", requestId, memory);
    const store = securityReviewStore(); upload.mockResolvedValue({ etag: '"blob-1"' });
    await store.put(initial.record, null);
    expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    await store.put(initial.record, '"blob-1"');
    expect(upload).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifMatch: '"blob-1"' } }));
    upload.mockRejectedValue({ statusCode: 412 }); await expect(store.put(initial.record, '"old"')).rejects.toThrow("REVIEW_CONFLICT");
    download.mockImplementation(async () => ({ etag: '"blob-1"', readableStreamBody: Readable.from([JSON.stringify(initial.record)]) }));
    expect((await store.get("owner", initial.record.id))?.record).toEqual(initial.record);
    await expect(store.get("other", initial.record.id)).rejects.toThrow("REVIEW_OWNER_MISMATCH");
  });
  it("does not treat backend failures as absence or permit memory mode in production", async () => {
    vi.stubEnv("ESP_SECURITY_REVIEW_STORE", "blob"); vi.stubEnv("AZURE_STORAGE_ACCOUNT", "simulationtest");
    download.mockRejectedValue({ code: "ContainerNotFound" }); await expect(securityReviewStore().get("owner", `sr-${"a".repeat(32)}`)).rejects.toMatchObject({ code: "ContainerNotFound" });
    download.mockRejectedValue({ code: "BlobNotFound" }); expect(await securityReviewStore().get("owner", `sr-${"a".repeat(32)}`)).toBeNull();
    vi.stubEnv("ESP_SECURITY_REVIEW_STORE", "memory"); vi.stubEnv("NODE_ENV", "production"); expect(() => securityReviewStore()).toThrow("MEMORY_REVIEW_STORE_NOT_ALLOWED");
  });
  it("rejects changes during maintenance before persisting any record", async () => {
    const store = createMemorySecurityReviewStore(); vi.stubEnv("ESP_STATE_WRITES_PAUSED", "true");
    await expect(executeSecurityReviewCommand(start, "owner", requestId, store)).rejects.toThrow("STATE_WRITES_PAUSED");
    expect((await store.list("owner")).records).toEqual([]);
  });
  it("creates one record for concurrent/repeated submissions and rejects changed input", async () => {
    const store = createMemorySecurityReviewStore();
    const entries = await Promise.all(Array.from({ length: 4 }, () => executeSecurityReviewCommand(start, "owner", requestId, store)));
    expect(new Set(entries.map((entry) => entry.record.id)).size).toBe(1);
    expect((await store.list("owner")).records).toHaveLength(1);
    await expect(executeSecurityReviewCommand({ ...start, query: "请安全审查 Docker Desktop" }, "owner", requestId, store)).rejects.toThrow("REVIEW_CONFLICT");
  });
  it("keeps owner boundaries, decisions and immutable evidence", async () => {
    const store = createMemorySecurityReviewStore(); const initial = await executeSecurityReviewCommand(start, "owner", requestId, store);
    expect(await store.get("other", initial.record.id)).toBeNull();
    const action = { action: "approve", id: initial.record.id, etag: initial.etag, reason: "已经核对模拟证据" };
    await expect(executeSecurityReviewCommand(action, "other", requestId, store)).rejects.toThrow("REVIEW_NOT_FOUND");
    const approved = await executeSecurityReviewCommand(action, "owner", requestId, store);
    expect((await executeSecurityReviewCommand(action, "owner", requestId, store)).record).toEqual(approved.record);
    await expect(executeSecurityReviewCommand({ ...action, action: "reject" }, "owner", requestId, store)).rejects.toThrow("REVIEW_CONFLICT");
    const corrupted = structuredClone(approved.record); corrupted.evidence[0].excerpt = "Changed source without a new review";
    expect(() => validateSecurityReview(corrupted)).toThrow("INVALID_REVIEW_EVIDENCE");
  });
  it("links a new submission after requesting information without changing the old review", async () => {
    const store = createMemorySecurityReviewStore(); const initial = await executeSecurityReviewCommand({ ...start, caseId: "missing" }, "owner", requestId, store);
    await executeSecurityReviewCommand({ action: "request_information", id: initial.record.id, etag: initial.etag, reason: "请补充范围证据" }, "owner", requestId, store);
    const next = await executeSecurityReviewCommand({ ...start, submissionId: "22222222-2222-4222-8222-222222222222", previousReviewId: initial.record.id }, "owner", requestId, store);
    expect(next.record.previousReviewId).toBe(initial.record.id); expect((await store.get("owner", initial.record.id))?.record.status).toBe("needs_information");
  });
});