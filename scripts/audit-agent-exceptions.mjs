import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requiredSections = [
  "Accountable owner",
  "Expiration (UTC)",
  "Exact scope",
  "Justification",
  "Compensating controls and rollback",
];

function section(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\n)### ${escaped}\\r?\\n+([^\\n][\\s\\S]*?)(?=\\r?\\n### |$)`, "u").exec(body)?.[1].trim();
}

export function exceptionRequestDigest(issue) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        number: issue.number,
        url: issue.html_url,
        body: typeof issue.body === "string" ? issue.body : "",
      }),
    )
    .digest("hex");
}

export function exceptionCodeOwners(content) {
  const owners =
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .filter((line) => line.split(/\s+/u)[0] === "*")
      .at(-1)
      ?.split(/\s+/u)
      .slice(1) ?? [];
  assert.ok(
    owners.length > 0 && owners.every((owner) => /^@[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(owner)),
    "Explicit individual default CODEOWNERS required for exception approval",
  );
  return owners.map((owner) => owner.slice(1).toLowerCase());
}

function hasOwnerApproval(issue, codeOwners, now) {
  const digest = exceptionRequestDigest(issue);
  const decisions = (Array.isArray(issue.comments) ? issue.comments : [])
    .filter(
      (comment) =>
        comment?.user?.type === "User" &&
        codeOwners.includes(String(comment.user.login).toLowerCase()) &&
        Number.isSafeInteger(comment.id) &&
        comment.id > 0 &&
        comment.updated_at === comment.created_at &&
        Number.isFinite(Date.parse(comment.created_at)) &&
        Date.parse(comment.created_at) <= now.valueOf() &&
        [`/approve-agent-exception sha256:${digest}`, `/revoke-agent-exception sha256:${digest}`].includes(
          comment.body?.trim(),
        ),
    )
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || left.id - right.id);
  return decisions.at(-1)?.body.trim() === `/approve-agent-exception sha256:${digest}`;
}

export function auditAgentExceptions(issues, now = new Date(), codeOwners = []) {
  assert.ok(Array.isArray(issues), "Agent exceptions input must be an array");
  assert.ok(Number.isFinite(now.valueOf()), "Audit time is invalid");
  const records = issues.map((issue) => {
    assert.ok(Number.isInteger(issue.number) && issue.number > 0, "Exception issue number is invalid");
    assert.equal(typeof issue.html_url, "string", `#${issue.number}: URL is invalid`);
    const body = typeof issue.body === "string" ? issue.body : "";
    const labels = new Set((issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)));
    const fields = Object.fromEntries(requiredSections.map((heading) => [heading, section(body, heading)]));
    const owner = fields["Accountable owner"];
    const expiresAt = fields["Expiration (UTC)"];
    const expiration = new Date(expiresAt ?? "");
    const malformed =
      requiredSections.some((heading) => !fields[heading]) ||
      !/^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner ?? "") ||
      !Number.isFinite(expiration.valueOf()) ||
      expiration.toISOString() !== expiresAt;
    const approved = labels.has("exception-approved") && hasOwnerApproval(issue, codeOwners, now);
    const state = malformed ? "malformed" : !approved ? "pending" : expiration <= now ? "expired" : "active";
    return {
      number: issue.number,
      url: issue.html_url,
      owner: owner ?? null,
      expiresAt: expiresAt ?? null,
      state,
      humanApprovalRequired: malformed || !approved || expiration <= now,
    };
  });
  const states = ["pending", "active", "expired", "malformed"];
  return {
    schemaVersion: 1,
    kind: "esp-agent-exception-audit",
    generatedAt: now.toISOString(),
    mutationAllowed: false,
    counts: Object.fromEntries(
      states.map((state) => [state, records.filter((record) => record.state === state).length]),
    ),
    records,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  assert.ok(inputPath && outputPath, "Usage: audit-agent-exceptions.mjs <issues.json> <report.json>");
  const issues = JSON.parse(await readFile(inputPath, "utf8"));
  const owners = exceptionCodeOwners(await readFile(new URL("../.github/CODEOWNERS", import.meta.url), "utf8"));
  const report = auditAgentExceptions(issues, new Date(), owners);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(`agent-exceptions: ${report.records.length} request(s) audited; mutationAllowed=false`);
}
