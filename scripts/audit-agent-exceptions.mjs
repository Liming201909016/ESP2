import assert from "node:assert/strict";
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

export function auditAgentExceptions(issues, now = new Date()) {
  assert.ok(Array.isArray(issues), "Agent exceptions input must be an array");
  assert.ok(Number.isFinite(now.valueOf()), "Audit time is invalid");
  const records = issues.map((issue) => {
    assert.ok(Number.isInteger(issue.number) && issue.number > 0, "Exception issue number is invalid");
    assert.equal(typeof issue.html_url, "string", `#${issue.number}: URL is invalid`);
    assert.equal(typeof issue.body, "string", `#${issue.number}: body is invalid`);
    const labels = new Set((issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)));
    const fields = Object.fromEntries(requiredSections.map((heading) => [heading, section(issue.body, heading)]));
    const owner = fields["Accountable owner"];
    const expiresAt = fields["Expiration (UTC)"];
    const expiration = new Date(expiresAt ?? "");
    const malformed =
      requiredSections.some((heading) => !fields[heading]) ||
      !/^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner ?? "") ||
      !Number.isFinite(expiration.valueOf()) ||
      expiration.toISOString() !== expiresAt;
    const approved = labels.has("exception-approved");
    const state = malformed ? "malformed" : !approved ? "pending" : expiration <= now ? "expired" : "active";
    return {
      number: issue.number,
      url: issue.html_url,
      owner: owner ?? null,
      expiresAt: expiresAt ?? null,
      state,
      humanApprovalRequired: !approved,
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
  const report = auditAgentExceptions(issues);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(`agent-exceptions: ${report.records.length} request(s) audited; mutationAllowed=false`);
}
