import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveAgentExceptionLifecycleProof,
  validateAgentExceptionLifecycleProof,
} from "./validate-agent-exception-lifecycle.mjs";
import { auditAgentExceptions } from "./audit-agent-exceptions.mjs";

const proof = JSON.parse(
  readFileSync(resolve(process.cwd(), "dashboards/closed-loop-agent-exception-lifecycle.json"), "utf8"),
);

describe("agent exception lifecycle proof", () => {
  it("verifies pending, active, expired, and malformed states", () => {
    expect(validateAgentExceptionLifecycleProof(proof)).toEqual(proof);
  });

  it("rejects mutation or fail-open claims", () => {
    expect(() => validateAgentExceptionLifecycleProof({ ...proof, mutationAllowed: true })).toThrow("proof is stale");
    expect(() => validateAgentExceptionLifecycleProof({ ...proof, expiryFailsClosed: false })).toThrow(
      "proof is stale",
    );
  });
  it("rejects a parser that removes the human approval requirement", () => {
    expect(() =>
      deriveAgentExceptionLifecycleProof((...args: Parameters<typeof auditAgentExceptions>) => {
        const report = auditAgentExceptions(...args);
        report.records[0].humanApprovalRequired = false;
        return report;
      }),
    ).toThrow("Human decision boundary drifted");
  });
});
