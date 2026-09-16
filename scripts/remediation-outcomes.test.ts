import { describe, expect, it } from "vitest";
import { deployWithRollback } from "./release-contract.mjs";
import { simulatedDriver } from "./deploy-release.mjs";

const release = (releaseId: string) => ({
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
});
const baseline = release("8e136994-5d3e-4ed6-8d4d-b188fa643983");
const candidate = release("406d2576-45dc-4a95-8388-3eed6eba215f");

describe("closed-loop remediation outcomes", () => {
  it.each(["candidate-unhealthy", "candidate-start-failure"])(
    "restores and verifies the last-known-good release after %s",
    async (scenario) => {
      const result = await deployWithRollback({
        candidate,
        baseline,
        driver: simulatedDriver(baseline, scenario),
        simulation: true,
      });

      expect(result).toMatchObject({ outcome: "rolled_back", errorCode: "CANDIDATE_RELEASE_FAILED" });
      expect(result.events.map((event: { step: string }) => event.step)).toEqual(
        expect.arrayContaining(["candidate.failed", "rollback.deployed", "rollback.verified"]),
      );
    },
  );
});
