import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditAccessError } from "../../../lib/esp/audit-contracts";

const { listAudit, getAudit } = vi.hoisted(() => ({ listAudit: vi.fn(), getAudit: vi.fn() }));
vi.mock("../../../lib/esp/audit-store", async (original) => ({ ...await original<typeof import("../../../lib/esp/audit-store")>(), listAudit, getAudit }));
import { GET } from "./route";
import { GET as detail } from "./[auditId]/route";
const id = `aud-8210900000000-${"a".repeat(32)}`;
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("audit read APIs", () => {
  it("passes only supported query fields and server identity to the store", async () => {
    listAudit.mockResolvedValue({ records: [], nextCursor: "next" });
    const traceId = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
    const response = await GET(new Request(`http://localhost/api/audit?cursor=current&traceId=${traceId}&owner=other`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ subject: "development:local" }), { cursor: "current", traceId });
    expect(await response.json()).toEqual({ records: [], nextCursor: "next" });
  });
  it("rejects invalid trace/reference/cursor input before fetching", async () => {
    for (const query of ["traceId=wrong", "reference=../../secret", `cursor=${"a".repeat(4_001)}`]) expect((await GET(new Request(`http://localhost/api/audit?${query}`))).status).toBe(400);
    expect(listAudit).not.toHaveBeenCalled();
  });
  it("uses indistinguishable not-found responses for absent or inaccessible IDs", async () => {
    getAudit.mockResolvedValue(null);
    const response = await detail(new Request("http://localhost"), { params: Promise.resolve({ auditId: id }) });
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });
  it("reports auth failures and data-plane outages distinctly", async () => {
    listAudit.mockRejectedValue(new AuditAccessError("AUTHENTICATION_REQUIRED", 401));
    expect((await GET(new Request("http://localhost/api/audit"))).status).toBe(401);
    getAudit.mockRejectedValue(new Error("Blob unavailable")); vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await detail(new Request("http://localhost"), { params: Promise.resolve({ auditId: id }) });
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "AUDIT_READ_FAILED" });
  });
});