import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRemediationOutcomes } from "./validate-remediation-outcomes.mjs";

const root = process.cwd();
const dashboard = JSON.parse(readFileSync(resolve(root, "dashboards/closed-loop-remediation-outcomes.json"), "utf8"));

describe("closed-loop remediation dashboard", () => {
  it("matches two executed and verified rollback classes", async () => {
    await expect(validateRemediationOutcomes(dashboard, root)).resolves.toEqual(dashboard);
  });

  it("rejects an overstated loop count", async () => {
    await expect(validateRemediationOutcomes({ ...dashboard, verifiedClosedLoopCount: 3 }, root)).rejects.toThrow(
      "dashboard is stale",
    );
  });

  it("rejects a missing rollback verification step", async () => {
    const changed = structuredClone(dashboard);
    changed.outcomes[0].eventSteps = changed.outcomes[0].eventSteps.filter(
      (step: string) => step !== "rollback.verified",
    );
    await expect(validateRemediationOutcomes(changed, root)).rejects.toThrow("dashboard is stale");
  });
});
