import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractWorkflowBody,
  validateCompiledShellAllowances,
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

  it("keeps shell-sensitive report text out of command arguments", () => {
    const body = extractWorkflowBody(source);
    expect(body).toContain("cat <<'ESP_AUDIT_REPORT_9F4C2A71'");
    expect(body).toContain("jq -Rs '{report: .}'");
    expect(body).not.toContain('--report "<complete Markdown report>"');
  });

  it("rejects an extra compiled shell allowance", () => {
    expect(() => validateCompiledShellAllowances(lock)).not.toThrow();
    const broadenedLock = lock.replace("copilot_harness.cjs", "copilot_harness.cjs shell(curl)");
    expect(() => validateCompiledShellAllowances(broadenedLock)).toThrow("approved set");
  });
});
