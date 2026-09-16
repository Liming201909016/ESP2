import assert from "node:assert/strict";
import crypto from "node:crypto";

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
  const configLines = compiledWorkflow
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(configPrefix));
  assert.equal(configLines.length, 1, "compiled workflow must contain exactly one SDK tool configuration");
  const configLine = configLines[0];
  const agentStart = compiledWorkflow.indexOf("\n  agent:\n");
  assert.ok(agentStart >= 0 && detectorStart > agentStart, "compiled workflow must contain agent before detection");
  assert.ok(
    compiledWorkflow.slice(agentStart, detectorStart).includes(configLine),
    "SDK tool configuration must remain inside the agent job",
  );
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

export function validateSdkInstallIntegrity(workflowSource, compiledWorkflow, sdkManifest, sdkLock) {
  const runtimeDependencies = {
    "@github/copilot-sdk": "1.0.11",
    undici: "6.28.0",
  };
  for (const [name, version] of Object.entries(runtimeDependencies)) {
    assert.equal(sdkManifest.dependencies?.[name], version, `${name} must be an exact runtime dependency`);
    assert.equal(sdkLock.packages?.[`node_modules/${name}`]?.version, version, `${name} lock version changed`);
  }

  assert.deepEqual(sdkManifest.dependencies, runtimeDependencies, "isolated SDK manifest dependencies changed");
  assert.deepEqual(
    sdkLock.packages?.[""]?.dependencies,
    runtimeDependencies,
    "isolated SDK root lock dependencies changed",
  );
  const expectedLockSha256 = "0fba1533cc5c0d7e1ab6cef963525e5c4b5573a353e6c872f7893bd013e13b7a";
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(sdkLock)).digest("hex"),
    expectedLockSha256,
    "isolated SDK lock digest changed",
  );
  const pending = Object.keys(runtimeDependencies);
  const visited = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    const entry = sdkLock.packages?.[`node_modules/${name}`];
    assert.ok(entry, `SDK dependency ${name} must exist in the isolated lock`);
    const resolved = new URL(entry.resolved ?? "https://invalid.local/");
    assert.equal(resolved.origin, "https://registry.npmjs.org", `${name} must resolve from the npm registry`);
    assert.match(resolved.pathname, new RegExp(`^/${name}/-/[^/]+\\.tgz$`, "u"), `${name} tarball path changed`);
    assert.equal(resolved.search, "", `${name} resolved URL must not contain a query`);
    assert.equal(resolved.hash, "", `${name} resolved URL must not contain a fragment`);
    assert.equal(resolved.username, "", `${name} resolved URL must not contain credentials`);
    assert.match(entry.integrity ?? "", /^sha512-[A-Za-z0-9+/]+={0,2}$/u, `${name} must have SHA-512 integrity`);
    pending.push(...Object.keys(entry.dependencies ?? {}), ...Object.keys(entry.optionalDependencies ?? {}));
  }

  const reinstallCommand = "npm ci --ignore-scripts --no-audit --no-fund --prefix .github/aw/copilot-sdk-runtime";
  assert.match(
    workflowSource,
    new RegExp(
      `pre-agent-steps:\\s+- name: Reinstall SDK from verified isolated lock[\\s\\S]*${expectedLockSha256}[\\s\\S]*${reinstallCommand}`,
      "u",
    ),
    "workflow must verify and reinstall the SDK from the isolated lock",
  );
  const generatedInstall = "npm install --ignore-scripts --no-save @github/copilot-sdk@1.0.11 undici@6.28.0";
  const installIndex = compiledWorkflow.indexOf(generatedInstall);
  const reinstallIndex = compiledWorkflow.indexOf(reinstallCommand);
  const globalExclusion = 'test ! -e "$global_root/@github/copilot-sdk" && test ! -e "$global_root/undici"';
  const globalExclusionIndex = compiledWorkflow.indexOf(globalExclusion);
  const removeGeneratedIndex = compiledWorkflow.indexOf("rm -rf node_modules/@github/copilot-sdk node_modules/undici");
  const sdkLink =
    'ln -s "${GITHUB_WORKSPACE}/.github/aw/copilot-sdk-runtime/node_modules/@github/copilot-sdk" node_modules/@github/copilot-sdk';
  const undiciLink =
    'ln -s "${GITHUB_WORKSPACE}/.github/aw/copilot-sdk-runtime/node_modules/undici" node_modules/undici';
  const sdkLinkIndex = compiledWorkflow.indexOf(sdkLink);
  const undiciLinkIndex = compiledWorkflow.indexOf(undiciLink);
  const executeIndex = compiledWorkflow.indexOf("- name: Execute GitHub Copilot CLI");
  assert.ok(installIndex >= 0, "compiled workflow must retain exact generated SDK versions");
  assert.ok(
    reinstallIndex > installIndex &&
      globalExclusionIndex > reinstallIndex &&
      removeGeneratedIndex > globalExclusionIndex &&
      sdkLinkIndex > removeGeneratedIndex &&
      undiciLinkIndex > sdkLinkIndex &&
      executeIndex > undiciLinkIndex,
    "verified SDK resolution boundary must be established after install and before execution",
  );
}
