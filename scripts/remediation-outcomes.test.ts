import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deployWithRollback } from "./release-contract.mjs";
import { simulatedDriver } from "./deploy-release.mjs";

const root = new URL("../artifacts/release-rehearsal-20260912-113017/", import.meta.url);
const baseline = JSON.parse(readFileSync(new URL("baseline/manifest.json", root), "utf8")).release;
const candidate = JSON.parse(readFileSync(new URL("candidate/manifest.json", root), "utf8")).release;

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
