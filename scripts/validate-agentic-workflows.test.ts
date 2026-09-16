import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractWorkflowBody,
  validateCompiledReadOnlyTools,
  validateFinalInstruction,
  validateSdkInstallIntegrity,
} from "./agentic-workflow-contract.mjs";

const source = readFileSync(resolve(import.meta.dirname, "../.github/workflows/agent-findings-audit.md"), "utf8");
const lock = readFileSync(resolve(import.meta.dirname, "../.github/workflows/agent-findings-audit.lock.yml"), "utf8");
const sdkRuntimePath = resolve(import.meta.dirname, "../.github/aw/copilot-sdk-runtime");
const sdkManifest = JSON.parse(readFileSync(resolve(sdkRuntimePath, "package.json"), "utf8"));
const sdkLockText = readFileSync(resolve(sdkRuntimePath, "package-lock.json"), "utf8");
const sdkLock = JSON.parse(sdkLockText);

describe("agentic workflow contract", () => {
  it("accepts a Markdown thematic break inside the workflow body", () => {
    const sourceWithThematicBreak = source.replace("# Agent Findings Audit", "# Agent Findings Audit\n\n---");
    const body = extractWorkflowBody(sourceWithThematicBreak);
    expect(body).toContain("# Agent Findings Audit\n\n---");
    expect(() => validateFinalInstruction(body)).not.toThrow();
  });

  it("rejects instructions after the required final report action", () => {
    const body = `${extractWorkflowBody(source)}\nPrint the report in chat.`;
    expect(() => validateFinalInstruction(body)).toThrow("final action");
  });

  it("rejects a second report-tool instruction", () => {
    const body = extractWorkflowBody(source).replace(
      "Your final action MUST",
      "You may call submit_findings_audit_report early.\n\nYour final action MUST",
    );
    expect(() => validateFinalInstruction(body)).toThrow("exactly once");
  });

  it("requires direct structured report submission without shell", () => {
    const body = extractWorkflowBody(source);
    expect(body).toContain("one direct structured tool call");
    expect(body).not.toContain("safeoutputs submit_findings_audit_report");
    expect(body).not.toContain("jq -Rs");
  });

  it("rejects search instructions unsupported by the SDK allowlist", () => {
    const body = extractWorkflowBody(source).replace(
      "Use only local file view operations on exact paths named by the findings, learned rules, and validators. Do not search the repository,",
      "Use only local file view and search operations.",
    );
    expect(() => validateFinalInstruction(body)).toThrow("read-only SDK capability");
  });

  it("requires learned-rule and dashboard inspection", () => {
    const body = extractWorkflowBody(source);
    expect(() =>
      validateFinalInstruction(body.replace("dashboards/candidate-active-retired-proof-pairs.json", "dashboard")),
    ).toThrow("dashboard metrics");
  });

  it("permits exact referenced lock-file evidence", () => {
    const body = extractWorkflowBody(source);
    expect(body).toContain(
      "The generated workflow lock may be viewed only when an exact ledger or validator reference",
    );
    const blockedBody = body.replace(
      "Your final action MUST",
      "Do not inspect the generated workflow lock.\n\nYour final action MUST",
    );
    expect(() => validateFinalInstruction(blockedBody)).toThrow("lock-file evidence");
  });

  it("validates every compiled harness and rejects broader agent tools", () => {
    expect(() => validateCompiledReadOnlyTools(lock)).not.toThrow();
    const broadenedLock = lock.replace("copilot_sdk_driver.cjs", "copilot_sdk_driver.cjs shell(curl)");
    expect(() => validateCompiledReadOnlyTools(broadenedLock)).toThrow("must not expose shell");
    const bashEnabledLock = lock.replace('"bash":false', '"bash":true');
    expect(() => validateCompiledReadOnlyTools(bashEnabledLock)).toThrow();
    const thirdHarnessLock = `${lock}\ncopilot_harness.cjs --allow-all-tools\n`;
    expect(() => validateCompiledReadOnlyTools(thirdHarnessLock)).toThrow("exactly one agent and one detector");
    const duplicateConfigLock = `${lock}\nGH_AW_COPILOT_SDK_TOOL_CONFIG: '{"capabilities":{"bash":true}}'\n`;
    expect(() => validateCompiledReadOnlyTools(duplicateConfigLock)).toThrow("exactly one SDK tool configuration");
  });

  it("requires an integrity-locked SDK reinstall before execution", () => {
    expect(() => validateSdkInstallIntegrity(source, lock, sdkManifest, sdkLock)).not.toThrow();
    const renderedLock = lock.replaceAll('\\"', '"');
    const alteredOrigin = sdkLockText.replace("https://registry.npmjs.org/undici/", "https://example.invalid/undici/");
    expect(() => validateSdkInstallIntegrity(source, lock, sdkManifest, JSON.parse(alteredOrigin))).toThrow(
      "canonical JSON digest changed",
    );
    const differentlyFormattedLock = JSON.parse(JSON.stringify(sdkLock, null, 4));
    expect(() => validateSdkInstallIntegrity(source, lock, sdkManifest, differentlyFormattedLock)).not.toThrow();
    const expandedManifest = structuredClone(sdkManifest);
    expandedManifest.dependencies.lodash = "4.17.23";
    expect(() => validateSdkInstallIntegrity(source, lock, expandedManifest, sdkLock)).toThrow(
      "manifest dependencies changed",
    );
    const reorderedLock = renderedLock
      .replace('npm ci --ignore-scripts --no-audit --no-fund --prefix "$RUNNER_TEMP/gh-aw/trusted-sdk-runtime"', "")
      .replace(
        "- name: Execute GitHub Copilot CLI",
        "- name: Execute GitHub Copilot CLI\n        # reinstall moved too late\n        npm ci --ignore-scripts --no-audit --no-fund --prefix .github/aw/copilot-sdk-runtime",
      );
    expect(() => validateSdkInstallIntegrity(source, reorderedLock, sdkManifest, sdkLock)).toThrow("exactly once");
    const writableInstallLock = renderedLock.replace('echo "NPM_CONFIG_DRY_RUN=true" >> "$GITHUB_ENV"', "true");
    expect(() => validateSdkInstallIntegrity(source, writableInstallLock, sdkManifest, sdkLock)).toThrow(
      "dry-run guard",
    );
    const targetConfigBypassLock = renderedLock.replace(
      'echo "NPM_CONFIG_USERCONFIG=$RUNNER_TEMP/empty-user-npmrc" >> "$GITHUB_ENV"',
      "true",
    );
    expect(() => validateSdkInstallIntegrity(source, targetConfigBypassLock, sdkManifest, sdkLock)).toThrow(
      "target-config isolation guard",
    );
    const projectConfigBypassLock = renderedLock.replace(
      'if test -e .npmrc || test -L .npmrc; then mv .npmrc "$RUNNER_TEMP/target-project-npmrc"; fi',
      "true",
    );
    expect(() => validateSdkInstallIntegrity(source, projectConfigBypassLock, sdkManifest, sdkLock)).toThrow(
      "project npm config isolation",
    );
    const restoreCommand =
      'if test -e "$RUNNER_TEMP/target-project-npmrc" || test -L "$RUNNER_TEMP/target-project-npmrc"; then mv "$RUNNER_TEMP/target-project-npmrc" .npmrc; fi';
    const earlyRestoreLock = renderedLock.replace(
      "- name: Execute GitHub Copilot CLI",
      `${restoreCommand}\n      - name: Execute GitHub Copilot CLI`,
    );
    expect(() => validateSdkInstallIntegrity(source, earlyRestoreLock, sdkManifest, sdkLock)).toThrow();
    const globalBypassLock = renderedLock.replace(
      'test ! -e "$global_root/@github/copilot-sdk" && test ! -e "$global_root/undici"',
      "true",
    );
    expect(() => validateSdkInstallIntegrity(source, globalBypassLock, sdkManifest, sdkLock)).toThrow("exactly once");
    const workspaceBypassLock = renderedLock.replace(
      'ln -s "$RUNNER_TEMP/gh-aw/trusted-sdk-runtime/node_modules/undici" node_modules/undici',
      "true",
    );
    expect(() => validateSdkInstallIntegrity(source, workspaceBypassLock, sdkManifest, sdkLock)).toThrow(
      "exactly once",
    );
    const lateInstallLock = renderedLock.replace(
      "- name: Execute GitHub Copilot CLI",
      "- name: Late mutation\n        run: npm install undici\n      - name: Execute GitHub Copilot CLI",
    );
    expect(() => validateSdkInstallIntegrity(source, lateInstallLock, sdkManifest, sdkLock)).toThrow(
      "must not be mutated",
    );
    const targetControlledSource = source.replace(
      "process.env.RUNNER_TEMP+'/gh-aw/trusted-sdk-runtime/package-lock.json'",
      "'.github/aw/copilot-sdk-runtime/package-lock.json'",
    );
    expect(() => validateSdkInstallIntegrity(targetControlledSource, lock, sdkManifest, sdkLock)).toThrow(
      "target checkout",
    );
  });
});
