import { describe, expect, it } from "vitest";
import { validateAgentFindingsLedger } from "./validate-agent-findings.mjs";

const root = process.cwd();
const observedAt = "2026-09-15T00:00:00.000Z";
const occurrence = {
  reviewRunId: "34958008531",
  targetSha: "a".repeat(40),
  observedAt,
  evidenceDigest: "b".repeat(64),
};

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ESP-AF-0001",
    fingerprint: "c".repeat(64),
    title: "Synthetic review finding",
    severity: "medium",
    area: "agent-review",
    path: "package.json",
    owner: "unassigned",
    status: "open",
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    recurrenceCount: 1,
    occurrences: [occurrence],
    dispositionReason: "",
    proofOfFix: null,
    promotedControl: null,
    riskExpiresAt: null,
    ...overrides,
  };
}

function ledger(findings: Record<string, unknown>[] = [], nextSequence = findings.length + 1) {
  return { schemaVersion: 1, kind: "esp-agent-findings-ledger", nextSequence, findings };
}

describe("agent findings ledger", () => {
  it("accepts the empty repository ledger", () => {
    expect(validateAgentFindingsLedger(ledger(), { root })).toEqual(ledger());
  });

  it("rejects mismatched recurrence counts", () => {
    expect(() => validateAgentFindingsLedger(ledger([finding({ recurrenceCount: 2 })]), { root })).toThrow(
      "recurrenceCount mismatch",
    );
  });

  it("requires proof for resolved findings", () => {
    expect(() =>
      validateAgentFindingsLedger(
        ledger([finding({ status: "resolved", owner: "@Liming201909016", dispositionReason: "Fixed in validation" })]),
        { root },
      ),
    ).toThrow("needs proofOfFix");
  });

  it("requires recurrence before promoting a control", () => {
    expect(() =>
      validateAgentFindingsLedger(
        ledger([
          finding({
            status: "resolved",
            owner: "@Liming201909016",
            dispositionReason: "Added regression coverage",
            proofOfFix: {
              commitSha: "d".repeat(40),
              checks: ["npm test"],
              testPaths: ["scripts/validate-agent-findings.test.ts"],
            },
            promotedControl: {
              kind: "test",
              path: "scripts/validate-agent-findings.test.ts",
              version: "1.0.0",
            },
          }),
        ]),
        { root },
      ),
    ).toThrow("promotion requires at least two occurrences");
  });

  it("rejects repository path traversal", () => {
    expect(() => validateAgentFindingsLedger(ledger([finding({ path: "../outside.ts" })]), { root })).toThrow(
      "path escapes repository",
    );
  });
});
