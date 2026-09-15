import assert from "node:assert/strict";

const normalizeWhitespace = (value) => value.trim().replace(/\s+/gu, " ");
const expectedFinalInstruction = normalizeWhitespace(`
Your final action MUST be one MCP tool call. Invoke \`submit_findings_audit_report\` from the \`safeoutputs\` MCP server
exactly once with the complete report in its \`report\` field. Do not print the report as a final chat response. This is an
MCP tool call, not a skill or file operation. Do not look up tool documentation, call a skill with that name, or call
\`noop\` after successful submission. If the report cannot be prepared, call \`noop\` exactly once with the reason and do not
fabricate a report.
`);

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
