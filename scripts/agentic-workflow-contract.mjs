import assert from "node:assert/strict";

const normalizeWhitespace = (value) => value.trim().replace(/\s+/gu, " ");
const expectedFinalInstruction = normalizeWhitespace(`
Your final action MUST be one direct structured tool call. Invoke \`submit_findings_audit_report\` exactly once with the
complete report in its \`report\` field. Do not use bash, a \`safeoutputs\` CLI command, a skill, or a file operation to submit
the report, and do not print it as a final chat response or call \`noop\` after successful submission. If the report cannot
be prepared, call \`noop\` exactly once with the reason and do not fabricate a report.
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

export function validateCompiledReadOnlyTools(compiledWorkflow) {
  const harnessLine = compiledWorkflow.split(/\r?\n/u).find((line) => line.includes("copilot_harness.cjs"));
  assert.ok(harnessLine, "compiled workflow must contain the Copilot harness command");
  assert.doesNotMatch(harnessLine, /shell\(/u, "compiled workflow must not expose shell tools");

  const configPrefix = "GH_AW_COPILOT_SDK_TOOL_CONFIG: ";
  const configLine = compiledWorkflow
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith(configPrefix));
  assert.ok(configLine, "compiled workflow must configure SDK tool permissions");
  const quotedConfig = configLine.slice(configPrefix.length);
  assert.match(quotedConfig, /^'.*'$/u, "SDK tool permissions must be a quoted JSON object");
  const config = JSON.parse(quotedConfig.slice(1, -1));
  assert.deepEqual(config.capabilities, {
    bash: false,
    edit: false,
    webFetch: false,
    webSearch: false,
    mcp: true,
    cliProxy: false,
  });
  assert.deepEqual(config.permissions.allowedTools, ["read", "safeoutputs"]);
  assert.deepEqual(config.explicitlyDisabledTools, ["bash", "cli-proxy", "edit", "github"]);
}
