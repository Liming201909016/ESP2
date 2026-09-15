import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { checkReleaseCompatibility, deployWithRollback, releaseManifestSchema, ReleaseError, validateArtifactRun } from "../../../scripts/release-contract.mjs";
import { createPackageManifest, stampStage, validateArchiveEntries, verifyReleaseBundle } from "../../../scripts/release-package.mjs";
import { assertRuntime, createAzureReleaseDriver, simulatedDriver } from "../../../scripts/deploy-release.mjs";

const baseline = {
  schemaVersion: 1 as const, application: "esp-platform" as const, releaseId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-09-12T00:00:00.000Z", sourceCommit: "a".repeat(40), buildRunId: "100", buildId: "baseline-build",
  applicationVersion: "0.1.0", nodeMajor: 24 as const, stateBackend: "postgres" as const, stateSchemaVersion: 1,
  knowledgeVersion: "2026.09-sim-v3", knowledgeDigest: "b".repeat(64),
};
const candidate = { ...baseline, releaseId: "22222222-2222-4222-8222-222222222222", sourceCommit: "c".repeat(40), buildRunId: "101", buildId: "candidate-build" };
const state = { backend: "postgres", prepared: true, writesPaused: false, schemaVersion: 1, migrationEnabled: false, knowledgeSeedEnabled: false };
function driver() {
  return { inspect: vi.fn(async () => ({ release: baseline, state })), stop: vi.fn(async () => undefined), deploy: vi.fn(async () => undefined), start: vi.fn(async () => undefined), verify: vi.fn(async () => undefined) };
}

describe("code-only release safety", () => {
  it("switches only after compatibility checks and verifies the exact candidate", async () => {
    const target = driver();
    expect((await deployWithRollback({ candidate, baseline, driver: target })).outcome).toBe("deployed");
    expect(target.deploy).toHaveBeenCalledExactlyOnceWith(candidate); expect(target.verify).toHaveBeenCalledExactlyOnceWith(candidate);
    expect(target.stop.mock.invocationCallOrder[0]).toBeGreaterThan(target.inspect.mock.invocationCallOrder[0]);
  });
  it.each(["state-schema", "knowledge-version", "knowledge-digest", "baseline", "seed", "migration", "paused", "local-source"])("blocks %s before stopping the application", async (change) => {
    const target = driver(); const next = { ...candidate }; const running = structuredClone({ release: baseline, state });
    if (change === "state-schema") next.stateSchemaVersion = 2;
    if (change === "knowledge-version") next.knowledgeVersion = "2026.10-new";
    if (change === "knowledge-digest") next.knowledgeDigest = "d".repeat(64);
    if (change === "baseline") running.release.buildRunId = "99";
    if (change === "seed") running.state.knowledgeSeedEnabled = true;
    if (change === "migration") running.state.migrationEnabled = true;
    if (change === "paused") running.state.writesPaused = true;
    if (change === "local-source") next.sourceCommit = "local";
    target.inspect.mockResolvedValue(running);
    await expect(deployWithRollback({ candidate: next, baseline, driver: target })).rejects.toThrow();
    expect(target.stop).not.toHaveBeenCalled(); expect(target.deploy).not.toHaveBeenCalled();
  });
  it("restores and verifies the previous package once when candidate health fails", async () => {
    const target = driver(); target.verify.mockRejectedValueOnce(new Error("private dependency details"));
    const result = await deployWithRollback({ candidate, baseline, driver: target });
    expect(result.outcome).toBe("rolled_back"); expect(target.deploy.mock.calls).toEqual([[candidate], [baseline]]);
    expect(target.verify.mock.calls).toEqual([[candidate], [baseline]]); expect(JSON.stringify(result)).not.toContain("private dependency");
  });
  it("restores the baseline after a definitively failed package deployment", async () => {
    const target = driver(); target.deploy.mockRejectedValueOnce(new ReleaseError("DEPLOYMENT_FAILED"));
    expect((await deployWithRollback({ candidate, baseline, driver: target })).outcome).toBe("rolled_back");
    expect(target.deploy.mock.calls).toEqual([[candidate], [baseline]]);
  });
  it("does not issue a competing ZIP deployment after an unknown Azure result", async () => {
    const target = driver(); target.deploy.mockRejectedValueOnce(new ReleaseError("DEPLOYMENT_RESULT_UNKNOWN"));
    const result = await deployWithRollback({ candidate, baseline, driver: target });
    expect(result).toMatchObject({ outcome: "recovery_required", errorCode: "DEPLOYMENT_RESULT_UNKNOWN" });
    expect(target.deploy).toHaveBeenCalledTimes(1); expect(target.start).not.toHaveBeenCalled();
  });
  it("restarts the unchanged release after a stop failure without writing another package", async () => {
    const target = driver(); target.stop.mockRejectedValueOnce(new Error("Uncertain stop"));
    expect((await deployWithRollback({ candidate, baseline, driver: target })).outcome).toBe("rolled_back");
    expect(target.deploy).not.toHaveBeenCalled(); expect(target.start).toHaveBeenCalledTimes(1); expect(target.verify).toHaveBeenCalledWith(baseline);
  });
  it("reports unconfirmed rollback for manual recovery and never loops", async () => {
    const target = driver(); target.verify.mockRejectedValue(new Error("Still unhealthy"));
    const result = await deployWithRollback({ candidate, baseline, driver: target });
    expect(result).toMatchObject({ outcome: "recovery_required", errorCode: "ROLLBACK_NOT_CONFIRMED" });
    expect(target.deploy).toHaveBeenCalledTimes(2); expect(target.start).toHaveBeenCalledTimes(2);
  });
  it("does not restart a release that is already running", async () => {
    const target = driver();
    expect((await deployWithRollback({ candidate: baseline, baseline, driver: target })).outcome).toBe("unchanged");
    expect(target.stop).not.toHaveBeenCalled();
  });
  it("allows local markers only for explicit simulation and denies extra manifest controls", () => {
    expect(() => checkReleaseCompatibility({ ...candidate, sourceCommit: "local" }, baseline, baseline, state, { simulation: true })).not.toThrow();
    expect(releaseManifestSchema.safeParse({ schemaVersion: 1, release: candidate, archive: { filename: "../other.zip", bytes: 20, sha256: "f".repeat(64) } }).success).toBe(false);
    expect(releaseManifestSchema.safeParse({ schemaVersion: 1, release: candidate, archive: { filename: "release.zip", bytes: 20, sha256: "f".repeat(64) }, publicAccess: true }).success).toBe(false);
  });
});

describe("release package integrity", () => {
  const entries = ["./server.js", "./.next/BUILD_ID", "./node_modules/pg/lib/index.js", "./node_modules.tar.gz", "./public/esp-release.json", "./.next/static/app.js"];
  it.each(["../private", "/absolute", "C:/outside", "public\\outside", "public/../../outside"])("rejects unsafe ZIP path %s", (path) => {
    expect(() => validateArchiveEntries([...entries, path])).toThrow("UNSAFE_ARCHIVE_PATH");
  });
  it("rejects environment files and duplicate archive names", () => {
    expect(() => validateArchiveEntries([...entries, "./.env.local"])).toThrow("ENVIRONMENT_FILE_IN_ARCHIVE");
    expect(() => validateArchiveEntries([...entries, "node_modules/app/.env"])).toThrow("ENVIRONMENT_FILE_IN_ARCHIVE");
    expect(() => validateArchiveEntries([...entries, "server.js"])).toThrow("DUPLICATE_ARCHIVE_PATH");
    expect(() => validateArchiveEntries(entries.filter((entry) => !entry.includes("pg/lib")))).toThrow("INCOMPLETE_STANDALONE_ARCHIVE");
  });
  it("verifies a real archive and rejects content tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "esp-release-test-"));
    const stage = join(directory, "stage"); const bundle = join(directory, "bundle");
    try {
      for (const folder of [".next/static", "public", "node_modules/pg/lib"]) await mkdir(join(stage, folder), { recursive: true });
      await mkdir(bundle);
      await writeFile(join(stage, "server.js"), "fixture server"); await writeFile(join(stage, ".next/BUILD_ID"), "fixture-build");
      await writeFile(join(stage, ".next/static/app.js"), "fixture static asset"); await writeFile(join(stage, "node_modules/pg/lib/index.js"), "fixture driver");
      await writeFile(join(stage, "node_modules.tar.gz"), "fixture dependency archive");
      const marker = await stampStage(stage);
      expect(marker.sourceCommit).toBe("local"); expect(marker.stateSchemaVersion).toBe(1);
      const archive = join(bundle, "release.zip");
      if (process.platform === "win32") execFileSync(join(process.env.SystemRoot!, "System32", "tar.exe"), ["-a", "-cf", archive, "-C", stage, "."]);
      else execFileSync("zip", ["-q", "-r", archive, "."], { cwd: stage });
      const manifest = await createPackageManifest(archive, join(bundle, "manifest.json"));
      expect((await verifyReleaseBundle(bundle)).release.releaseId).toBe(marker.releaseId);
      expect(manifest.archive.bytes).toBeGreaterThan(0);
      await writeFile(archive, Buffer.concat([await readFile(archive), Buffer.from("tampered")]));
      await expect(verifyReleaseBundle(bundle)).rejects.toThrow("ARCHIVE_INTEGRITY_FAILED");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("runtime checks and offline release rehearsal", () => {
  const snapshot = {
    release: candidate, health: { status: "healthy", ready: true, state: { backend: "postgres", writesPaused: false } },
    readiness: { status: "ready", checks: { blob: { status: "healthy" }, search: { status: "healthy" }, state: { status: "healthy" } } },
    state: { backend: "postgres", writesPaused: false, postgres: { prepared: true, schemaVersion: 1 } },
    catalog: { skills: [{ sources: [{ version: candidate.knowledgeVersion }] }] },
  };
  it("requires the exact runtime release and working state/search/storage", () => {
    expect(() => assertRuntime(snapshot, candidate)).not.toThrow();
    expect(() => assertRuntime({ ...snapshot, release: baseline }, candidate)).toThrow("RUNNING_RELEASE_MISMATCH");
    const failed = structuredClone(snapshot); failed.readiness.checks.search.status = "unavailable";
    expect(() => assertRuntime(failed, candidate)).toThrow("DEPENDENCIES_NOT_READY");
    expect(() => assertRuntime({ ...snapshot, state: { ...snapshot.state, backend: "blob" } }, candidate)).toThrow("DATABASE_NOT_PREPARED");
  });
  it.each([
    ["success", "deployed"], ["candidate-unhealthy", "rolled_back"], ["rollback-unhealthy", "recovery_required"], ["deployment-unknown", "recovery_required"],
  ])("rehearses %s entirely offline", async (scenario, outcome) => {
    const result = await deployWithRollback({ candidate, baseline, driver: simulatedDriver(baseline, scenario), simulation: true });
    expect(result.mode).toBe("simulation"); expect(result.outcome).toBe(outcome);
  });
  it("cannot enable the Azure driver on an ordinary local process", () => {
    vi.stubEnv("ESP_DEV_DEPLOY_ENABLED", "false");
    try { expect(() => createAzureReleaseDriver(new Map())).toThrow("LIVE_DEPLOYMENT_NOT_ENABLED"); }
    finally { vi.unstubAllEnvs(); }
  });
});

describe("GitHub artifact provenance and deployment gates", () => {
  const run = { id: 100, workflow_id: 42, head_repository: { full_name: "example/esp" }, head_branch: "main", path: ".github/workflows/release.yml", event: "push", head_sha: "a".repeat(40), status: "completed", conclusion: "success" };
  const expected = { repository: "example/esp", workflowId: 42 };
  it("accepts only same-repository successful main-branch release runs", () => {
    expect(validateArtifactRun(run, expected)).toEqual({ runId: "100", sourceCommit: "a".repeat(40) });
    expect(() => validateArtifactRun({ ...run, head_branch: "feature" }, expected)).toThrow();
    expect(() => validateArtifactRun({ ...run, head_repository: { full_name: "fork/esp" } }, expected)).toThrow();
    expect(() => validateArtifactRun({ ...run, event: "pull_request" }, expected)).toThrow();
    expect(() => validateArtifactRun({ ...run, conclusion: "failure" }, expected)).toThrow();
    expect(() => validateArtifactRun({ ...run, path: ".github/workflows/other.yml" }, expected)).toThrow();
  });
  it("allows the current run's already-gated candidate but not an unfinished baseline", () => {
    const current = { ...run, status: "in_progress", conclusion: null };
    expect(validateArtifactRun(current, { ...expected, currentRunId: "100" }).runId).toBe("100");
    expect(() => validateArtifactRun(current, expected)).toThrow("ARTIFACT_RUN_NOT_SUCCESSFUL");
  });
  it("keeps actual Azure access behind an opt-in switch and preserves manual-only model evaluations", async () => {
    const yaml = createRequire(import.meta.url)("js-yaml");
    const release = yaml.load(await readFile(".github/workflows/release.yml", "utf8"));
    const validate = yaml.load(await readFile(".github/workflows/validate.yml", "utf8"));
    expect(release.on.push.branches).toEqual(["main"]); expect(release.on.pull_request).toBeUndefined(); expect(release.on.schedule).toBeUndefined();
    expect(release.jobs.deploy.if).toContain("vars.ESP_DEV_DEPLOY_ENABLED == 'true'");
    expect(release.jobs.deploy.permissions["id-token"]).toBe("write"); expect(release.jobs.build.permissions).toBeUndefined();
    expect(release.concurrency["cancel-in-progress"]).toBe(false);
    expect(validate.on.schedule).toBeUndefined(); expect(validate.on.workflow_dispatch.inputs.knowledge_evaluation.default).toBe(false);
    expect(validate.jobs.infrastructure.steps.length).toBe(10);
  });
});