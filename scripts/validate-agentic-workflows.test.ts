import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractWorkflowBody, validateFinalInstruction } from "./validate-agentic-workflows.mjs";

const source = readFileSync(resolve(import.meta.dirname, "../.github/workflows/agent-findings-audit.md"), "utf8");

describe("agentic workflow contract", () => {
  it("accepts a Markdown thematic break inside the workflow body", () => {
    const body = extractWorkflowBody(source).replace("# Agent Findings Audit", "# Agent Findings Audit\n\n---");
    expect(() => validateFinalInstruction(body)).not.toThrow();
  });

  it("rejects instructions after the required final MCP action", () => {
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
});
