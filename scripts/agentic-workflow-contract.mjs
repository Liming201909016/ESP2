import assert from "node:assert/strict";

const normalizeWhitespace = (value) => value.trim().replace(/\s+/gu, " ");
const expectedFinalInstruction = normalizeWhitespace(`
Your final action MUST be one shell-tool invocation that uses this data-safe pattern exactly once:

\`\`\`bash
cat <<'ESP_AUDIT_REPORT_9F4C2A71' > /tmp/gh-aw/findings-audit-report.md
<complete Markdown report>
ESP_AUDIT_REPORT_9F4C2A71
jq -Rs '{report: .}' /tmp/gh-aw/findings-audit-report.md | safeoutputs submit_findings_audit_report .
\`\`\`

The report MUST NOT contain \`ESP_AUDIT_REPORT_9F4C2A71\` on a line by itself. The single-quoted heredoc prevents shell
expansion, and \`jq -Rs\` carries the report as one JSON string; never interpolate report text into a command argument. Do
not print the report as a final chat response, call a skill, run any other command, or invoke \`noop\` after successful
submission. If the report cannot be prepared, invoke \`safeoutputs noop --message "audit report could not be prepared"\`
exactly once and do not fabricate a report.
`);

const approvedShellAllowances = [
  "cat",
  "date",
  "echo",
  "grep",
  "head",
  "ls",
  "printf",
  "pwd",
  "safeoutputs",
  "safeoutputs:*",
  "sort",
  "tail",
  "uniq",
  "wc",
  "yq",
];

export function extractWorkflowBody(workflowSource) {
  const delimiters = [...workflowSource.matchAll(/^---\s*$/gmu)];
  assert.ok(delimiters.length >= 2 && delimiters[0].index === 0, "findings audit must contain leading frontmatter");
  const closingDelimiter = delimiters[1];
  return workflowSource.slice(closingDelimiter.index + closingDelimiter[0].length);
}

export function validateFinalInstruction(workflowBody) {
  const normalizedWorkflowBody = normalizeWhitespace(workflowBody);
  assert.ok(
    normalizedWorkflowBody.endsWith(expectedFinalInstruction),
    "findings audit body must require the exposed report tool as its final action",
  );
  assert.equal(
    workflowBody.match(/submit_findings_audit_report/gu)?.length,
    1,
    "findings audit body must name the report tool exactly once",
  );
}

export function validateCompiledShellAllowances(compiledWorkflow) {
  const harnessLine = compiledWorkflow.split(/\r?\n/u).find((line) => line.includes("copilot_harness.cjs"));
  assert.ok(harnessLine, "compiled workflow must contain the Copilot harness command");
  const actual = [...harnessLine.matchAll(/shell\(([^)]+)\)/gu)].map((match) => match[1]);
  assert.deepEqual(actual, approvedShellAllowances, "compiled workflow shell allowances must match the approved set");
}
