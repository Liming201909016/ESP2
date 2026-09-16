import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAgentExceptionLifecycleProof } from "./validate-agent-exception-lifecycle.mjs";

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
});
