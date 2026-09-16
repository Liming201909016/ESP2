import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageGovernanceMcp, stageGovernanceMcp } from "../../../../scripts/package-governance-mcp.mjs";
const { begin, finish } = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin, finish } }));
import { GET, POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/governance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const command = { repositoryId: "esp", skillId: "inspect-repository-governance" };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ESP_DEV_PERMISSIONS", "governance.read");
  vi.stubEnv("ESP_GOVERNANCE_PACKAGE", "");
  vi.stubEnv("ESP_GOVERNANCE_MANIFEST_SHA256", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("governance API", () => {
  it("invokes both real packaged MCP tools through the API after audit start", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "esp-governance-route-"));
    try {
      const directory = join(temporary, "runtime");
      const packaged = await packageGovernanceMcp(directory);
      const expectedHash = createHash("sha256")
        .update(await readFile(join(directory, "manifest.json")))
        .digest("hex");
      const staged = join(temporary, "staged-runtime");
      await expect(stageGovernanceMcp(directory, staged, "0".repeat(64))).rejects.toThrow(
        "GOVERNANCE_MANIFEST_MISMATCH",
      );
      await stageGovernanceMcp(directory, staged, expectedHash);
      vi.stubEnv("ESP_GOVERNANCE_PACKAGE", staged);
      vi.stubEnv("ESP_GOVERNANCE_MANIFEST_SHA256", expectedHash);
      for (const skillId of ["inspect-repository-governance", "get-repository-validation-plan"]) {
        const response = await POST(request({ repositoryId: "esp", skillId }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.skillId).toBe(skillId);
        expect(body.provenance).toEqual(packaged.manifest.provenance);
        expect(body.audit.status).toBe("recorded");
        expect(finish).toHaveBeenLastCalledWith(
          expect.objectContaining({
            status: "completed",
            trace: expect.arrayContaining([
              expect.objectContaining({ step: `governance.commit.${body.provenance.sourceCommit}` }),
            ]),
          }),
          "development:local",
        );
      }
      expect(begin.mock.invocationCallOrder[0]).toBeLessThan(finish.mock.invocationCallOrder[0]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);
  it("exposes two explicit Skills without executing or assuming a configured package", async () => {
    const response = await GET(new Request("http://localhost/api/governance"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const catalog = await response.json();
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.packageStatus).toBe("not_configured");
    expect(begin).not.toHaveBeenCalled();
    const invoked = await POST(request(command));
    expect(invoked.status).toBe(503);
    expect((await invoked.json()).audit.status).toBe("recorded");
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", requiredPermissions: ["governance.read"] }),
      "development:local",
    );
  });
  it("rejects denied callers and injected commands; audit failure blocks reads", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
    expect((await GET(new Request("http://localhost/api/governance"))).status).toBe(403);
    expect((await POST(request(command))).status).toBe(403);
    vi.stubEnv("ESP_DEV_PERMISSIONS", "governance.read");
    expect((await POST(request({ ...command, path: "C:/private" }))).status).toBe(400);
    expect(begin).not.toHaveBeenCalled();
    begin.mockRejectedValueOnce(new Error("private endpoint"));
    const denied = await POST(request(command));
    expect(denied.status).toBe(503);
    const body = await denied.json();
    expect(body.error).toBe("AUDIT_START_FAILED");
    expect(JSON.stringify(body)).not.toContain("private endpoint");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ESP_ENVIRONMENT", "production");
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false");
    expect((await GET(new Request("http://localhost/api/governance"))).status).toBe(401);
  });
});
