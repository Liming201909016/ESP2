import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractWorkflowBody,
  validateCompiledReadOnlyTools,
  validateFinalInstruction,
} from "./agentic-workflow-contract.mjs";

const source = readFileSync(resolve(import.meta.dirname, "../.github/workflows/agent-findings-audit.md"), "utf8");
const lock = readFileSync(resolve(import.meta.dirname, "../.github/workflows/agent-findings-audit.lock.yml"), "utf8");

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

  it("validates every compiled harness and rejects broader agent tools", () => {
    expect(() => validateCompiledReadOnlyTools(lock)).not.toThrow();
    const broadenedLock = lock.replace("copilot_sdk_driver.cjs", "copilot_sdk_driver.cjs shell(curl)");
    expect(() => validateCompiledReadOnlyTools(broadenedLock)).toThrow("must not expose shell");
    const bashEnabledLock = lock.replace('"bash":false', '"bash":true');
    expect(() => validateCompiledReadOnlyTools(bashEnabledLock)).toThrow();
    const thirdHarnessLock = `${lock}\ncopilot_harness.cjs --allow-all-tools\n`;
    expect(() => validateCompiledReadOnlyTools(thirdHarnessLock)).toThrow("exactly one agent and one detector");
  });
});
