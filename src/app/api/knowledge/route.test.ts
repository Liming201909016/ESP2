import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareKnowledgeDocument } from "../../../lib/esp/knowledge-chunks";
import { KnowledgeDocumentError } from "../../../lib/esp/knowledge-document-store";
const { auditBegin, auditFinish } = vi.hoisted(() => ({ auditBegin: vi.fn(), auditFinish: vi.fn() }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin: auditBegin, finish: auditFinish }, getAudit: vi.fn() }));

const { listManagedDocuments, createKnowledgeDraft, getManagedDocument, changeKnowledgePublication } = vi.hoisted(() => ({
  listManagedDocuments: vi.fn(), createKnowledgeDraft: vi.fn(), getManagedDocument: vi.fn(), changeKnowledgePublication: vi.fn(),
}));
vi.mock("../../../lib/esp/knowledge-document-store", async (original) => ({
  ...await original<typeof import("../../../lib/esp/knowledge-document-store")>(), listManagedDocuments, getManagedDocument,
}));
vi.mock("../../../lib/esp/knowledge-publication", async (original) => ({
  ...await original<typeof import("../../../lib/esp/knowledge-publication")>(), createKnowledgeDraft, changeKnowledgePublication,
}));

import { GET, POST } from "./route";
import { POST as preview } from "./preview/route";
import { GET as detail, POST as action } from "./[documentId]/route";

const id = "kb-0123456789abcdef0123456789abcdef";
const input = {
  title: "Import test", skillId: "search-expense-policy" as const, documentNumber: "SIM-FIN-DEMO-001", owner: "Demo team",
  effectiveDate: "2026-09-10", dataKind: "policy" as const, filename: "test.md", content: "Simulated travel text for the import endpoint.", simulated: true as const,
};
const stored = { document: prepareKnowledgeDocument(input, id, "development:local", "2026-09-10T10:00:00.000Z"), etag: "v1" };
const context = { params: Promise.resolve({ documentId: id }) };
function request(body: unknown) {
  return new Request("http://localhost/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ESP_ENVIRONMENT", "dev");
  vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true");
  vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
  listManagedDocuments.mockResolvedValue({ documents: [stored], nextCursor: "next-page" });
  createKnowledgeDraft.mockResolvedValue(stored);
  getManagedDocument.mockResolvedValue(stored);
  changeKnowledgePublication.mockResolvedValue({ ...stored, document: { ...stored.document, status: "published" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("knowledge management API", () => {
  it("blocks publication if the audit start cannot be persisted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    auditBegin.mockRejectedValue(new Error("Audit outage"));
    const response = await action(request({ action: "publish", etag: "v1" }), context);
    expect(response.status).toBe(503); expect(changeKnowledgePublication).not.toHaveBeenCalled();
  });

  it("retains the draft receipt when audit completion fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    auditFinish.mockRejectedValue(new Error("Audit finish failed"));
    const response = await POST(request(input)); const body = await response.json();
    expect(response.status).toBe(201); expect(body.entry.id).toBe(id); expect(body.audit.status).toBe("incomplete");
    expect(createKnowledgeDraft).toHaveBeenCalledTimes(1);
  });

  it("lists builtins and a bounded imported page without sending full text", async () => {
    const response = await GET(new Request("http://localhost/api/knowledge?cursor=cursor1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.builtins).toHaveLength(101);
    expect(body.documents[0]).not.toHaveProperty("content");
    expect(body.nextCursor).toBe("next-page");
    expect(body.canManage).toBe(true);
    expect(listManagedDocuments).toHaveBeenCalledWith("cursor1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("previews input without persisting or indexing", async () => {
    const response = await preview(request(input));
    expect(response.status).toBe(200);
    expect((await response.json()).chunks[0].content).toBe(input.content);
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
    expect(changeKnowledgePublication).not.toHaveBeenCalled();
  });

  it("saves imports only as drafts using the current test subject", async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(201);
    expect((await response.json()).entry.status).toBe("draft");
    expect(createKnowledgeDraft).toHaveBeenCalledWith(input, "development:local");
  });

  it("uses current ETag on explicit publish commands", async () => {
    const response = await action(request({ action: "publish", etag: "v1" }), context);
    expect(response.status).toBe(200);
    expect(changeKnowledgePublication).toHaveBeenCalledWith(id, "publish", "v1", expect.any(Object));
  });

  it("keeps builtins read-only in the detail view", async () => {
    const response = await detail(new Request("http://localhost/api/knowledge/dev-hr-leave"), { params: Promise.resolve({ documentId: "dev-hr-leave" }) });
    const body = await response.json();
    expect(body.canManage).toBe(false);
    expect(body.etag).toBeNull();
    expect(body.chunks).toHaveLength(1);
    expect(getManagedDocument).not.toHaveBeenCalled();
  });

  it.each([{ filename: "demo.pdf" }, { simulated: false }, { content: "" }])("rejects invalid imports: %j", async (changes) => {
    const response = await POST(request({ ...input, ...changes }));
    expect(response.status).toBe(400);
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
  });

  it("bounds uploaded JSON size before saving", async () => {
    const response = await POST(request({ ...input, content: "a".repeat(300_000) }));
    expect(response.status).toBe(413);
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
  });

  it("requires explicit DEV management mode without changing Entra settings", async () => {
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false");
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(request(input));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("DEV_MANAGEMENT_REQUIRED");
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
  });

  it("requires knowledge permission for both reading and importing", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read");
    expect((await GET(new Request("http://localhost/api/knowledge"))).status).toBe(403);
    expect((await POST(request(input))).status).toBe(403);
    expect(listManagedDocuments).not.toHaveBeenCalled();
  });

  it("returns a conflict rather than overwriting concurrent edits", async () => {
    changeKnowledgePublication.mockRejectedValue(new KnowledgeDocumentError("CONFLICT"));
    const response = await action(request({ action: "publish", etag: "stale" }), context);
    expect(response.status).toBe(409);
  });

  it("returns failed indexing state for a retry instead of reporting success", async () => {
    changeKnowledgePublication.mockResolvedValue({ ...stored, document: { ...stored.document, status: "error", lastError: "INDEX_PUBLISH_FAILED" } });
    const response = await action(request({ action: "publish", etag: "v1" }), context);
    expect(response.status).toBe(502);
    expect((await response.json()).entry.lastError).toBe("INDEX_PUBLISH_FAILED");
  });
});