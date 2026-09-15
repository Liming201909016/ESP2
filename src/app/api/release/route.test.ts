import { beforeEach, describe, expect, it, vi } from "vitest";
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile }));
import { GET } from "./route";

const marker = {
  schemaVersion: 1, application: "esp-platform", releaseId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-09-12T00:00:00.000Z", sourceCommit: "a".repeat(40), buildRunId: "100", buildId: "current-build",
  applicationVersion: "0.1.0", nodeMajor: 24, stateBackend: "postgres", stateSchemaVersion: 1,
  knowledgeVersion: "2026.09-sim-v3", knowledgeDigest: "b".repeat(64),
};
beforeEach(() => vi.resetAllMocks());
describe("current packaged release identity", () => {
  it("returns only a schema-valid marker for the same Next build, without caching", async () => {
    readFile.mockResolvedValueOnce(JSON.stringify(marker)).mockResolvedValueOnce("current-build\n");
    const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toEqual(marker);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects a stale marker left by a different package", async () => {
    readFile.mockResolvedValueOnce(JSON.stringify(marker)).mockResolvedValueOnce("different-build");
    const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "RELEASE_BUILD_MISMATCH" });
  });
  it("reports an unregistered baseline without inventing a release ID", async () => {
    readFile.mockRejectedValue({ code: "ENOENT", message: "private path" });
    const response = await GET(); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "RELEASE_UNTRACKED" });
  });
  it("does not expose malformed metadata or filesystem details", async () => {
    readFile.mockResolvedValue(JSON.stringify({ ...marker, token: "private credentials" }));
    const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "RELEASE_METADATA_INVALID" });
  });
});