import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const recoveryPolicy = JSON.parse(readFileSync(new URL("../.github/self-healing.json", import.meta.url), "utf8"));

const transientSignals = [
  ["hosted_runner_lost", /hosted runner lost communication with the server/i],
  ["runner_shutdown", /runner has received a shutdown signal/i],
  ["runner_service_unreachable", /runner was unable to contact the service/i],
  ["runner_provisioning_failed", /error occurred while provisioning (?:the )?hosted runner/i],
  ["hosted_runner_unavailable", /no available hosted runners/i],
  ["action_download_failed", /failed to (?:download action|resolve action download info)/i],
];

export function validateRecoveryPolicy(policy) {
  assert.equal(policy.schemaVersion, 1, "Recovery policy schemaVersion must be 1");
  assert.equal(policy.mode, "containment", "Recovery policy must remain containment-only");
  assert.equal(policy.signal, "flaky-infrastructure-rerun", "Recovery containment signal changed");
  assert.deepEqual(policy.workflows, ["Security", "Validate"], "Recovery policy workflows changed");
  assert.equal(policy.eligibleClassification, "transient_runner_failure", "Recovery classification changed");
  assert.equal(policy.action, "rerun_failed_jobs", "Recovery action changed");
  assert.equal(policy.maxAttempts, 1, "Recovery must remain a one-attempt containment");
  assert.equal(policy.terminalAction, "human_handoff", "Recovery terminal action changed");
  assert.deepEqual(
    policy.proofArtifacts,
    ["ci-recovery-decision.json", "ci-recovery-terminal.json"],
    "Recovery proof artifacts changed",
  );
}

validateRecoveryPolicy(recoveryPolicy);

export function classifyRecovery(input) {
  assert.ok(recoveryPolicy.workflows.includes(input.workflow), "Unsupported recovery workflow");
  assert.match(input.runId, /^\d+$/, "Invalid workflow run ID");
  assert.match(input.headSha, /^[a-f0-9]{40}$/, "Invalid workflow head SHA");
  assert.match(input.classifierSha, /^[a-f0-9]{40}$/, "Invalid classifier SHA");
  assert.equal(input.attempt, recoveryPolicy.maxAttempts, "Only the first workflow attempt is eligible for recovery");

  const signals = input.logsAvailable
    ? transientSignals.filter(([, pattern]) => pattern.test(input.failedLog)).map(([id]) => id)
    : [];
  const eligible = input.logsAvailable && signals.length > 0;
  return {
    schemaVersion: 1,
    workflow: input.workflow,
    runId: input.runId,
    attempt: input.attempt,
    headSha: input.headSha,
    classifierSha: input.classifierSha,
    failureLogSha256: createHash("sha256").update(input.failedLog).digest("hex"),
    classification: !input.logsAvailable
      ? "logs_unavailable"
      : eligible
        ? "transient_runner_failure"
        : "deterministic_or_unknown",
    signals,
    action: eligible ? recoveryPolicy.action : recoveryPolicy.terminalAction,
  };
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    assert.ok(key && value !== undefined, "Expected key-value recovery arguments");
    parsed[key] = value;
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArguments(process.argv.slice(2));
  const decision = classifyRecovery({
    workflow: args.workflow,
    runId: args["run-id"],
    attempt: Number(args.attempt),
    headSha: args["head-sha"],
    classifierSha: args["classifier-sha"],
    logsAvailable: args["logs-available"] === "true",
    failedLog: await readFile(args.log, "utf8"),
  });
  await writeFile(args.output, `${JSON.stringify({ ...decision, generatedAt: new Date().toISOString() }, null, 2)}\n`, {
    flag: "wx",
  });
  if (args["github-output"]) {
    await writeFile(args["github-output"], `rerun=${decision.action === "rerun_failed_jobs"}\n`, { flag: "a" });
  }
  console.log(`recovery: ${decision.classification}; action=${decision.action}`);
}
