import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditAgentExceptions, exceptionRequestDigest } from "./audit-agent-exceptions.mjs";

const now = new Date("2026-09-16T00:00:00.000Z");
const labels = (approved) => ["agent-exception", ...(approved ? ["exception-approved"] : [])];
const body = (owner, expiresAt) => `### Accountable owner

${owner}

### Expiration (UTC)

${expiresAt}

### Exact scope

Synthetic exception lifecycle proof

### Justification

Exercise the fail-closed parser without granting an exception.

### Compensating controls and rollback

Synthetic input only; no repository or production mutation.
`;

export function deriveAgentExceptionLifecycleProof(audit = auditAgentExceptions) {
  const issues = [
    {
      number: 1,
      html_url: "https://example.invalid/1",
      body: body("@owner", "2026-10-01T00:00:00.000Z"),
      labels: labels(false),
    },
    {
      number: 2,
      html_url: "https://example.invalid/2",
      body: body("@owner", "2026-10-01T00:00:00.000Z"),
      labels: labels(true),
    },
    {
      number: 3,
      html_url: "https://example.invalid/3",
      body: body("@owner", "2026-09-01T00:00:00.000Z"),
      labels: labels(true),
    },
    { number: 4, html_url: "https://example.invalid/4", body: body("owner", "tomorrow"), labels: labels(true) },
  ];
  const approvedIssues = issues.map((issue) => ({
    ...issue,
    comments: issue.labels.includes("exception-approved")
      ? [
          {
            id: issue.number,
            user: { login: "owner", type: "User" },
            body: `/approve-agent-exception sha256:${exceptionRequestDigest(issue)}`,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
          },
        ]
      : [],
  }));
  const report = audit(approvedIssues, now, ["owner"]);
  const verifiedStates = report.records.map((record) => record.state);
  assert.deepEqual(verifiedStates, ["pending", "active", "expired", "malformed"]);
  assert.deepEqual(
    report.records.map((record) => record.humanApprovalRequired),
    [true, false, true, true],
    "Human decision boundary drifted",
  );
  return {
    schemaVersion: 1,
    kind: "esp-agent-exception-lifecycle-proof",
    mode: "synthetic-contract",
    humanDecisionRequired: report.records[0].humanApprovalRequired && !report.records[1].humanApprovalRequired,
    mutationAllowed: report.mutationAllowed,
    expiryFailsClosed: report.records[2].state === "expired" && report.records[3].state === "malformed",
    verifiedStates,
    stateCounts: report.counts,
  };
}

export function validateAgentExceptionLifecycleProof(proof) {
  assert.deepEqual(proof, deriveAgentExceptionLifecycleProof(), "Agent exception lifecycle proof is stale");
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, "..");
  const proof = JSON.parse(
    readFileSync(resolve(root, "dashboards/closed-loop-agent-exception-lifecycle.json"), "utf8"),
  );
  validateAgentExceptionLifecycleProof(proof);
  console.log("agent-exception-lifecycle: pending, active, expired, and malformed states verified");
}
