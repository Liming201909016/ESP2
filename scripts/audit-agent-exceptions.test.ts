import { describe, expect, it } from "vitest";
import { auditAgentExceptions } from "./audit-agent-exceptions.mjs";

const body = (owner = "@Liming201909016", expires = "2026-10-01T00:00:00.000Z") => `### Accountable owner

${owner}

### Expiration (UTC)

${expires}

### Exact scope

.github/workflows/agent-review.yml read-only tools

### Justification

Temporary compatibility investigation.

### Compensating controls and rollback

Read-only permissions, artifact review, and immediate disable on failure.
`;

const issue = (overrides: Record<string, unknown> = {}) => ({
  number: 12,
  html_url: "https://github.com/synthetic/repository/issues/12",
  body: body(),
  labels: [{ name: "agent-exception" }],
  ...overrides,
});

describe("agent exception audit", () => {
  const now = new Date("2026-09-16T00:00:00.000Z");

  it("keeps unapproved requests pending", () => {
    expect(auditAgentExceptions([issue()], now)).toMatchObject({
      mutationAllowed: false,
      counts: { pending: 1, active: 0, expired: 0, malformed: 0 },
      records: [{ state: "pending", humanApprovalRequired: true }],
    });
  });

  it("distinguishes active and expired human-approved exceptions", () => {
    const labels = [{ name: "agent-exception" }, { name: "exception-approved" }];
    const report = auditAgentExceptions(
      [
        issue({ number: 13, labels }),
        issue({ number: 14, labels, body: body("@Liming201909016", "2026-09-01T00:00:00.000Z") }),
      ],
      now,
    );
    expect(report.counts).toEqual({ pending: 0, active: 1, expired: 1, malformed: 0 });
  });

  it("fails closed on malformed ownership or expiry", () => {
    expect(auditAgentExceptions([issue({ body: body("owner", "tomorrow") })], now)).toMatchObject({
      counts: { malformed: 1 },
      records: [{ state: "malformed" }],
    });
  });
});
