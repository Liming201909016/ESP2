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
      "Use only local file view operations on exact paths named by the ledger and validator. Do not search the repository,",
      "Use only local file view and search operations.",
    );
    expect(() => validateFinalInstruction(body)).toThrow("read-only SDK capability");
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
    const reorderedLock = lock
      .replace("npm ci --ignore-scripts --no-audit --no-fund --prefix .github/aw/copilot-sdk-runtime", "")
      .replace(
        "- name: Execute GitHub Copilot CLI",
        "- name: Execute GitHub Copilot CLI\n        # reinstall moved too late\n        npm ci --ignore-scripts --no-audit --no-fund --prefix .github/aw/copilot-sdk-runtime",
      );
    expect(() => validateSdkInstallIntegrity(source, reorderedLock, sdkManifest, sdkLock)).toThrow(
      "resolution boundary",
    );
    const onlineInstallLock = lock.replace('echo "NPM_CONFIG_OFFLINE=true" >> "$GITHUB_ENV"', "true");
    expect(() => validateSdkInstallIntegrity(source, onlineInstallLock, sdkManifest, sdkLock)).toThrow(
      "offline SDK cache",
    );
    const globalBypassLock = lock.replace(
      'test ! -e "$global_root/@github/copilot-sdk" && test ! -e "$global_root/undici"',
      "true",
    );
    expect(() => validateSdkInstallIntegrity(source, globalBypassLock, sdkManifest, sdkLock)).toThrow("exactly once");
    const workspaceBypassLock = lock.replace(
      'ln -s "${GITHUB_WORKSPACE}/.github/aw/copilot-sdk-runtime/node_modules/undici" node_modules/undici',
      "true",
    );
    expect(() => validateSdkInstallIntegrity(source, workspaceBypassLock, sdkManifest, sdkLock)).toThrow(
      "exactly once",
    );
    const lateInstallLock = lock.replace(
      "- name: Execute GitHub Copilot CLI",
      "- name: Late mutation\n        run: npm install undici\n      - name: Execute GitHub Copilot CLI",
    );
    expect(() => validateSdkInstallIntegrity(source, lateInstallLock, sdkManifest, sdkLock)).toThrow(
      "must not be mutated",
    );
  });
});
