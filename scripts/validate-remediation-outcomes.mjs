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

function release(root, kind) {
  return JSON.parse(
    readFileSync(resolve(root, `artifacts/release-rehearsal-20260912-113017/${kind}/manifest.json`), "utf8"),
  ).release;
}

export async function deriveRemediationOutcomes(root) {
  const baseline = release(root, "baseline");
  const candidate = release(root, "candidate");
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
  assert.deepEqual(
    dashboard,
    await deriveRemediationOutcomes(resolve(root)),
    "Closed-loop remediation dashboard is stale",
  );
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
