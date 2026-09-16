import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeGovernance, governanceCatalog } from "./governance";
import type { IdentityContext } from "./identity";

const identity: IdentityContext = {
  authenticated: true,
  subject: "synthetic-owner",
  displayName: null,
  source: "development",
  permissions: ["governance.read"],
};
const input = { repositoryId: "esp", skillId: "get-repository-validation-plan" };
const provenance = {
  repositoryId: "esp",
  mode: "packaged_snapshot",
  sourceCommit: "a".repeat(40),
  dirtyWorktree: false,
  collectedAt: "2026-09-16T00:00:00.000Z",
  inputDigest: "b".repeat(64),
};
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "esp-governance-api-"));
  const manifest = JSON.stringify({
    schemaVersion: 1,
    nodeMajor: 24,
    provenance,
    inputHashes: [{ path: "package.json", sha256: "c".repeat(64) }],
    files: { "server.mjs": "d".repeat(64), "client.mjs": "e".repeat(64), "governance-snapshot.json": "f".repeat(64) },
  });
  await writeFile(join(directory, "manifest.json"), manifest);
  vi.stubEnv("ESP_GOVERNANCE_PACKAGE", directory);
  vi.stubEnv("ESP_GOVERNANCE_MANIFEST_SHA256", createHash("sha256").update(manifest).digest("hex"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
describe("governed repository tools", () => {
  it("requires dedicated permission and rejects arbitrary targets before invoking or auditing", async () => {
    const writer = { begin: vi.fn(), finish: vi.fn() };
    const invoke = vi.fn();
    for (const user of [
      { ...identity, authenticated: false },
      { ...identity, subject: null },
      { ...identity, permissions: ["knowledge.read"] as IdentityContext["permissions"] },
    ]) {
      await expect(executeGovernance(input, user, { writer, invoke })).rejects.toThrow();
      await expect(governanceCatalog(user)).rejects.toThrow();
    }
    for (const invalid of [
      { ...input, repositoryId: "other" },
      { ...input, path: directory },
      { ...input, skillId: "shell" },
    ])
      await expect(executeGovernance(invalid, identity, { writer, invoke })).rejects.toThrow("INVALID_REQUEST");
    expect(invoke).not.toHaveBeenCalled();
    expect(writer.begin).not.toHaveBeenCalled();
  });
  it("requires audit start for reads and preserves incomplete audit after successful invocation", async () => {
    const order: string[] = [];
    const writer = {
      begin: vi.fn(async () => {
        order.push("audit");
      }),
      finish: vi.fn(async () => {
        throw new Error("private audit error");
      }),
    };
    const invoke = vi.fn(async () => {
      order.push("invoke");
      return {
        repositoryId: "esp",
        tool: "esp_validation_plan",
        provenance,
        result: { schemaVersion: 1, mutatesRepository: false, commands: ["npm test"] },
      };
    });
    const response = await executeGovernance(input, identity, { writer, invoke });
    expect(order).toEqual(["audit", "invoke"]);
    expect(response.status).toBe(200);
    expect(response.body.audit.status).toBe("incomplete");
    expect(writer.begin).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: false, requiredPermissions: ["governance.read"] }),
    );
    writer.begin.mockRejectedValueOnce(new Error("private audit error"));
    invoke.mockClear();
    await expect(executeGovernance(input, identity, { writer, invoke })).rejects.toThrow("AUDIT_START_FAILED");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("fails closed on package and provenance mismatches and audits execution errors", async () => {
    const writer = { begin: vi.fn(), finish: vi.fn() };
    const invoke = vi.fn(async () => ({
      repositoryId: "esp",
      tool: "esp_validation_plan",
      provenance: { ...provenance, sourceCommit: "c".repeat(40) },
      result: {},
    }));
    expect((await executeGovernance(input, identity, { writer, invoke })).status).toBe(503);
    expect(writer.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "GOVERNANCE_UNAVAILABLE" }),
      identity.subject,
    );
    expect((await governanceCatalog(identity)).packageStatus).toBe("manifest_verified");
    await writeFile(join(directory, "manifest.json"), (await readFile(join(directory, "manifest.json"), "utf8")) + " ");
    invoke.mockClear();
    expect((await governanceCatalog(identity)).packageStatus).toBe("unavailable");
    expect((await executeGovernance(input, identity, { writer, invoke })).status).toBe(503);
    expect(invoke).not.toHaveBeenCalled();
  });
});
