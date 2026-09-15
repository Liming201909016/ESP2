import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const releaseMarkerSchema = z.object({
  schemaVersion: z.literal(1), application: z.literal("esp-platform"), releaseId: z.uuid(),
  createdAt: z.iso.datetime(), sourceCommit: z.union([z.literal("local"), z.string().regex(/^[a-f0-9]{40}$/)]),
  buildRunId: z.string().regex(/^[1-9]\d*$/).max(20).nullable(), buildId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  applicationVersion: z.string().regex(/^\d+\.\d+\.\d+$/), nodeMajor: z.literal(24),
  stateBackend: z.literal("postgres"), stateSchemaVersion: z.number().int().positive(),
  knowledgeVersion: z.string().min(1).max(80), knowledgeDigest: hash,
}).strict();

export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(1), release: releaseMarkerSchema,
  archive: z.object({ filename: z.literal("release.zip"), sha256: hash, bytes: z.number().int().positive().max(500_000_000) }).strict(),
}).strict();

export class ReleaseError extends Error {
  constructor(code) { super(code); this.name = "ReleaseError"; this.code = code; }
}

export function requireRelease(condition, code) {
  if (!condition) throw new ReleaseError(code);
}

export function digest(value) { return createHash("sha256").update(value).digest("hex"); }

export function validateArtifactRun(run, { repository, workflowId, currentRunId = "" }) {
  requireRelease(run.head_repository?.full_name === repository && run.head_branch === "main" && run.path === ".github/workflows/release.yml" && run.workflow_id === workflowId, "UNTRUSTED_ARTIFACT_RUN");
  requireRelease(["push", "workflow_dispatch"].includes(run.event) && /^[a-f0-9]{40}$/.test(run.head_sha), "UNTRUSTED_ARTIFACT_SOURCE");
  requireRelease(String(run.id) === String(currentRunId) || run.status === "completed" && run.conclusion === "success", "ARTIFACT_RUN_NOT_SUCCESSFUL");
  return { runId: String(run.id), sourceCommit: run.head_sha };
}

export async function readReleaseBundle(directory) {
  const manifest = releaseManifestSchema.parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
  const bytes = await readFile(join(directory, manifest.archive.filename));
  requireRelease(bytes.length === manifest.archive.bytes && digest(bytes) === manifest.archive.sha256, "ARCHIVE_INTEGRITY_FAILED");
  return manifest;
}

export function checkReleaseCompatibility(candidateInput, baselineInput, currentInput, state, options = {}) {
  const candidate = releaseMarkerSchema.parse(candidateInput);
  const baseline = releaseMarkerSchema.parse(baselineInput);
  const current = releaseMarkerSchema.parse(currentInput);
  requireRelease(JSON.stringify(current) === JSON.stringify(baseline), "BASELINE_DOES_NOT_MATCH_RUNNING_RELEASE");
  requireRelease(options.simulation === true || [candidate, baseline].every((release) => release.sourceCommit !== "local" && release.buildRunId !== null), "CI_PROVENANCE_REQUIRED");
  requireRelease(state.backend === "postgres" && state.prepared === true && state.writesPaused === false, "STATE_NOT_READY_FOR_RELEASE");
  requireRelease(candidate.stateSchemaVersion === baseline.stateSchemaVersion && candidate.stateSchemaVersion === state.schemaVersion, "STATE_SCHEMA_CHANGE_REQUIRES_MANUAL_RELEASE");
  requireRelease(candidate.knowledgeVersion === baseline.knowledgeVersion && candidate.knowledgeDigest === baseline.knowledgeDigest, "KNOWLEDGE_CHANGE_REQUIRES_MANUAL_RELEASE");
  requireRelease(state.migrationEnabled === false && state.knowledgeSeedEnabled === false, "MIGRATION_OR_SEED_FLAG_ACTIVE");
  return { candidate, baseline };
}

export async function deployWithRollback({ candidate, baseline, driver, simulation = false }) {
  const events = [];
  const record = (step) => events.push({ step, at: new Date().toISOString() });
  const running = await driver.inspect();
  checkReleaseCompatibility(candidate, baseline, running.release, running.state, { simulation });
  record("preflight.passed");
  if (candidate.releaseId === baseline.releaseId) return { mode: simulation ? "simulation" : "azure", outcome: "unchanged", candidateId: candidate.releaseId, baselineId: baseline.releaseId, events };
  let candidateAttempted = false;
  try {
    record("application.stop_requested");
    await driver.stop();
    record("application.stopped");
    candidateAttempted = true;
    await driver.deploy(candidate);
    record("candidate.deployed");
    await driver.start();
    record("application.start_requested");
    await driver.verify(candidate);
    record("candidate.verified");
    return { mode: simulation ? "simulation" : "azure", outcome: "deployed", candidateId: candidate.releaseId, baselineId: baseline.releaseId, events };
  } catch (failure) {
    record("candidate.failed");
    if (failure instanceof ReleaseError && failure.code === "DEPLOYMENT_RESULT_UNKNOWN") {
      record("candidate.deployment_unconfirmed");
      return { mode: simulation ? "simulation" : "azure", outcome: "recovery_required", candidateId: candidate.releaseId, baselineId: baseline.releaseId, errorCode: "DEPLOYMENT_RESULT_UNKNOWN", events };
    }
    try {
      if (candidateAttempted) {
        await driver.stop();
        record("rollback.stopped");
        await driver.deploy(baseline);
        record("rollback.deployed");
      }
      await driver.start();
      record("rollback.start_requested");
      await driver.verify(baseline);
      record("rollback.verified");
      return { mode: simulation ? "simulation" : "azure", outcome: "rolled_back", candidateId: candidate.releaseId, baselineId: baseline.releaseId, errorCode: "CANDIDATE_RELEASE_FAILED", events };
    } catch {
      record("rollback.failed");
      return { mode: simulation ? "simulation" : "azure", outcome: "recovery_required", candidateId: candidate.releaseId, baselineId: baseline.releaseId, errorCode: "ROLLBACK_NOT_CONFIRMED", events };
    }
  }
}