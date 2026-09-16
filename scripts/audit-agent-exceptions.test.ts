import { describe, expect, it } from "vitest";
import { auditAgentExceptions, exceptionCodeOwners, exceptionRequestDigest } from "./audit-agent-exceptions.mjs";
import { collectAgentExceptions } from "./collect-agent-exceptions.mjs";

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
  const owners = ["liming201909016"];
  const approval = (request: ReturnType<typeof issue>, overrides = {}) => ({
    id: 1,
    user: { login: "Liming201909016", type: "User" },
    body: `/approve-agent-exception sha256:${exceptionRequestDigest(request)}`,
    created_at: "2026-09-15T00:00:00.000Z",
    updated_at: "2026-09-15T00:00:00.000Z",
    ...overrides,
  });

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
      ].map((request) => ({ ...request, comments: [approval(request)] })),
      now,
      owners,
    );
    expect(report.counts).toEqual({ pending: 0, active: 1, expired: 1, malformed: 0 });
  });

  it("fails closed on malformed ownership or expiry", () => {
    expect(auditAgentExceptions([issue({ body: body("owner", "tomorrow") })], now)).toMatchObject({
      counts: { malformed: 1 },
      records: [{ state: "malformed" }],
    });
  });
  it("requires unedited CODEOWNER evidence bound to the exact request and honors revocation", () => {
    const request = issue({ labels: ["agent-exception", "exception-approved"] });
    for (const comments of [
      [],
      [approval(request, { user: { login: "outsider", type: "User" } })],
      [approval(request, { user: { login: "Liming201909016", type: "Bot" } })],
      [approval(request, { updated_at: "2026-09-15T01:00:00.000Z" })],
      [approval(request, { created_at: "2026-09-17T00:00:00.000Z", updated_at: "2026-09-17T00:00:00.000Z" })],
    ]) {
      expect(auditAgentExceptions([{ ...request, comments }], now, owners).records[0]).toMatchObject({
        state: "pending",
        humanApprovalRequired: true,
      });
    }
    const approved = { ...request, comments: [approval(request)] };
    expect(auditAgentExceptions([approved], now, owners).records[0].state).toBe("active");
    expect(
      auditAgentExceptions([{ ...approved, body: request.body + "Changed scope" }], now, owners).records[0].state,
    ).toBe("pending");
    expect(
      auditAgentExceptions(
        [
          {
            ...approved,
            comments: [
              ...approved.comments,
              approval(request, { id: 2, body: `/revoke-agent-exception sha256:${exceptionRequestDigest(request)}` }),
            ],
          },
        ],
        now,
        owners,
      ).records[0].state,
    ).toBe("pending");
    expect(exceptionCodeOwners("* @Liming201909016\n/src/ @Other")).toEqual(owners);
    expect(() => exceptionCodeOwners("* @organization/team")).toThrow();
  });
  it("classifies cleared issue bodies without aborting other requests", () => {
    const report = auditAgentExceptions(
      [issue({ number: 1, body: null }), issue({ number: 2, body: "" }), issue({ number: 3 })],
      now,
      owners,
    );
    expect(report.records.map((record) => record.state)).toEqual(["malformed", "malformed", "pending"]);
    expect(report.records.every((record) => record.humanApprovalRequired)).toBe(true);
  });
  it("collects multiple issue/comment pages and unlabelled form requests without trusting embedded comments", async () => {
    const requests = [
      issue({ title: "[Agent exception] Missing labels", labels: [], body: null }),
      issue({ number: 13 }),
    ];
    const paths: string[] = [];
    const collected = await collectAgentExceptions("synthetic/repository", async (path: string) => {
      paths.push(path);
      if (path.includes("/issues?"))
        return [
          [
            ...Array.from({ length: 100 }, (_, index) => ({
              number: index + 100,
              title: "Ordinary issue",
              labels: [],
            })),
            requests[0],
          ],
          [requests[1], { ...requests[1], number: 14, pull_request: {} }],
        ];
      return [[{ id: 1 }], [{ id: 2 }]];
    });
    expect(collected.map((entry) => entry.number)).toEqual([12, 13]);
    expect(collected.every((entry) => entry.comments.length === 2)).toBe(true);
    expect(JSON.parse(JSON.stringify(collected))).toHaveLength(2);
    expect(paths).toHaveLength(3);
    await expect(collectAgentExceptions("../other", async () => [])).rejects.toThrow();
    await expect(collectAgentExceptions("synthetic/repository", async () => requests)).rejects.toThrow("paginated");
  });
});
