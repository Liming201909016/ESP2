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
  const harnessLines = compiledWorkflow.split(/\r?\n/u).filter((line) => line.includes("copilot_harness.cjs"));
  assert.equal(harnessLines.length, 2, "compiled workflow must contain exactly one agent and one detector harness");
  const sdkHarness = harnessLines.find((line) => line.includes("copilot_sdk_driver.cjs"));
  assert.ok(sdkHarness, "compiled workflow must contain the SDK agent harness");
  assert.doesNotMatch(sdkHarness, /shell\(|--allow-all-tools/u, "SDK agent harness must not expose shell tools");

  const detectorHarness = harnessLines.find((line) => !line.includes("copilot_sdk_driver.cjs"));
  assert.ok(detectorHarness, "compiled workflow must contain the isolated detector harness");
  assert.match(detectorHarness, /--allow-all-tools/u, "detector harness contract changed unexpectedly");

  const detectorStart = compiledWorkflow.indexOf("\n  detection:\n");
  const nextJob = [...compiledWorkflow.matchAll(/^  [a-zA-Z0-9_-]+:\s*$/gmu)].find(
    (match) => match.index > detectorStart + 1,
  );
  const detectorEnd = nextJob?.index ?? -1;
  assert.ok(
    detectorStart >= 0 && detectorEnd > detectorStart,
    "compiled workflow must contain an isolated detection job",
  );
  const detectorJob = compiledWorkflow.slice(detectorStart, detectorEnd);
  assert.ok(detectorJob.includes(detectorHarness), "non-SDK harness must remain inside the detection job");
  assert.match(detectorJob, /GH_AW_PHASE: detection/u, "detector harness must declare the detection phase");
  assert.match(
    detectorJob,
    /- name: Checkout repository for patch context\s+if: needs\.agent\.outputs\.has_patch == 'true'/u,
    "detector checkout must remain conditional on a declared agent patch",
  );
  assert.doesNotMatch(
    detectorJob,
    /^\s+(?:contents|issues|pull-requests|checks|deployments): write\s*$/mu,
    "detector job must not receive repository write permissions",
  );

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
