import { describe, expect, it } from "vitest";
import { classifyRecovery, validateRecoveryPolicy } from "./classify-ci-recovery.mjs";

const base = {
  workflow: "Validate",
  runId: "34946133620",
  attempt: 1,
  headSha: "a".repeat(40),
  classifierSha: "b".repeat(40),
  logsAvailable: true,
};

describe("CI recovery classification", () => {
  it("rejects recovery policy expansion", () => {
    const policy = {
      schemaVersion: 1,
      mode: "containment",
      signal: "flaky-infrastructure-rerun",
      workflows: ["Security", "Validate"],
      eligibleClassification: "transient_runner_failure",
      action: "rerun_failed_jobs",
      maxAttempts: 1,
      terminalAction: "human_handoff",
      proofArtifacts: ["ci-recovery-decision.json", "ci-recovery-terminal.json"],
    };
    expect(() => validateRecoveryPolicy(policy)).not.toThrow();
    expect(() => validateRecoveryPolicy({ ...policy, maxAttempts: 2 })).toThrow("one-attempt");
    expect(() => validateRecoveryPolicy({ ...policy, action: "rerun_all_jobs" })).toThrow("action changed");
    expect(() => validateRecoveryPolicy({ ...policy, signal: "generic-retry" })).toThrow("signal changed");
  });

  it("reruns a known hosted-runner communication loss once", () => {
    const decision = classifyRecovery({ ...base, failedLog: "The hosted runner lost communication with the server." });
    expect(decision).toMatchObject({
      classification: "transient_runner_failure",
      signals: ["hosted_runner_lost"],
      action: "rerun_failed_jobs",
      classifierSha: "b".repeat(40),
    });
    expect(decision.failureLogSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when failed-job logs are unavailable", () => {
    expect(classifyRecovery({ ...base, logsAvailable: false, failedLog: "" })).toMatchObject({
      classification: "logs_unavailable",
      signals: [],
      action: "human_handoff",
    });
  });

  it("hands deterministic test failures to a human", () => {
    expect(
      classifyRecovery({
        ...base,
        failedLog: "AssertionError: HACKATHON-BACKLOG.md: missing link target artifacts/example.json",
      }),
    ).toMatchObject({ classification: "deterministic_or_unknown", signals: [], action: "human_handoff" });
  });

  it("rejects a second-attempt recovery decision", () => {
    expect(() =>
      classifyRecovery({ ...base, attempt: 2, failedLog: "The runner has received a shutdown signal" }),
    ).toThrow("Only the first workflow attempt is eligible");
  });
});
