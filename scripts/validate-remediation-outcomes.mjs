import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { simulatedDriver } from "./deploy-release.mjs";
import { deployWithRollback } from "./release-contract.mjs";

const scenarios = [
  { failureClass: "candidate-health-failure", scenario: "candidate-unhealthy" },
  { failureClass: "candidate-start-failure", scenario: "candidate-start-failure" },
];

function syntheticRelease(releaseId) {
  return {
    schemaVersion: 1,
    application: "esp-platform",
    releaseId,
    createdAt: "2026-09-16T00:00:00.000Z",
    sourceCommit: "local",
    buildRunId: null,
    buildId: "synthetic-closed-loop-proof",
    applicationVersion: "0.1.0",
    nodeMajor: 24,
    stateBackend: "postgres",
    stateSchemaVersion: 1,
    knowledgeVersion: "synthetic-proof-v1",
    knowledgeDigest: "a".repeat(64),
  };
}

export async function deriveRemediationOutcomes() {
  const baseline = syntheticRelease("8e136994-5d3e-4ed6-8d4d-b188fa643983");
  const candidate = syntheticRelease("406d2576-45dc-4a95-8388-3eed6eba215f");
  const outcomes = [];
  for (const scenario of scenarios) {
    const result = await deployWithRollback({
      candidate,
      baseline,
      driver: simulatedDriver(baseline, scenario.scenario),
      simulation: true,
    });
    assert.equal(result.outcome, "rolled_back", `${scenario.failureClass}: rollback did not complete`);
    assert.equal(result.errorCode, "CANDIDATE_RELEASE_FAILED", `${scenario.failureClass}: unexpected error code`);
    const eventSteps = result.events.map((event) => event.step);
    for (const required of ["candidate.failed", "rollback.deployed", "rollback.verified"]) {
      assert.ok(eventSteps.includes(required), `${scenario.failureClass}: missing ${required}`);
    }
    outcomes.push({
      ...scenario,
      detection: "candidate.failed",
      remediation: "redeploy-last-good",
      verifiedOutcome: "rollback.verified",
      eventSteps,
    });
  }
  return {
    schemaVersion: 1,
    kind: "esp-closed-loop-remediation-outcomes",
    mode: "synthetic",
    automatedRollback: true,
    distinctFailureClassCount: new Set(outcomes.map((outcome) => outcome.failureClass)).size,
    verifiedClosedLoopCount: outcomes.filter((outcome) => outcome.eventSteps.includes(outcome.verifiedOutcome)).length,
    outcomes,
  };
}

export async function validateRemediationOutcomes(dashboard, root = process.cwd()) {
  void root;
  assert.deepEqual(dashboard, await deriveRemediationOutcomes(), "Closed-loop remediation dashboard is stale");
  return dashboard;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, "..");
  const dashboard = JSON.parse(readFileSync(resolve(root, "dashboards/closed-loop-remediation-outcomes.json"), "utf8"));
  await validateRemediationOutcomes(dashboard, root);
  console.log(
    `remediation-outcomes: ${dashboard.verifiedClosedLoopCount} verified loops across ${dashboard.distinctFailureClassCount} failure classes`,
  );
}
