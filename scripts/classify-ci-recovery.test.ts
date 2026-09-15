import { describe, expect, it } from "vitest";
import { classifyRecovery } from "./classify-ci-recovery.mjs";

const base = {
  workflow: "Validate",
  runId: "34946133620",
  attempt: 1,
  headSha: "a".repeat(40),
  classifierSha: "b".repeat(40),
  logsAvailable: true,
};

describe("CI recovery classification", () => {
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
