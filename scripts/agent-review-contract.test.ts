import { describe, expect, it } from "vitest";
import {
  buildAgentReviewReport,
  extractCopilotReview,
  parseModelReview,
  renderAgentReviewMarkdown,
} from "./agent-review-contract.mjs";

const context = {
  schemaVersion: 1,
  kind: "esp-agent-review-context",
  reviewContractVersion: "1.0.0",
  repository: "Liming201909016/ESP2",
  targetKind: "commit",
  targetReference: "a".repeat(40),
  targetSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  changedFiles: ["scripts/example.mjs"],
  diffSha256: "c".repeat(64),
  reviewerConfigSha256: "d".repeat(64),
  promptSha256: "e".repeat(64),
};

function modelReview(overrides = {}) {
  return {
    schemaVersion: 1,
    summary: "One bounded issue was found.",
    findings: [
      {
        findingKey: "scripts/example:missing-guard",
        severity: "high",
        confidence: "high",
        title: "Missing mutation guard",
        path: "scripts/example.mjs",
        line: 12,
        behavior: "The operation can execute before the required guard is checked.",
        evidence: "The call appears before the explicit permission condition.",
        recommendation: "Move the guard before the operation and add a rejection test.",
        testGap: "No test proves the operation is skipped when the guard fails.",
      },
    ],
    openQuestions: [],
    residualRisks: ["Runtime policy enforcement was not executed."],
    ...overrides,
  };
}

describe("agent review contract", () => {
  it("validates and fingerprints a bounded model review", () => {
    const source = JSON.stringify(modelReview());
    const parsed = parseModelReview(source, context);
    const report = buildAgentReviewReport({
      context,
      modelReview: parsed,
      workflowRunId: "34958008531",
      model: "gpt-5.4",
      copilotCliVersion: "1.0.83",
      modelOutput: source,
      usage: "{}\n",
    });
    expect(report).toMatchObject({
      reviewId: "ESP-AR-34958008531",
      ledgerAction: "human_review_required",
      findings: [{ findingKey: "scripts/example:missing-guard" }],
    });
    expect(report.findings[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.findings[0].evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(renderAgentReviewMarkdown(report)).toContain("human review required");
  });

  it("accepts a no-findings review with residual risk", () => {
    expect(
      parseModelReview(
        JSON.stringify(modelReview({ findings: [], summary: "No defect was found in the bounded diff." })),
        context,
      ).findings,
    ).toEqual([]);
  });

  it("rejects findings outside the changed files", () => {
    const value = modelReview();
    value.findings[0].path = "src/unrelated.ts";
    expect(() => parseModelReview(JSON.stringify(value), context)).toThrow("outside changed files");
  });

  it("rejects duplicate finding keys", () => {
    const value = modelReview();
    value.findings.push({ ...value.findings[0] });
    expect(() => parseModelReview(JSON.stringify(value), context)).toThrow("Duplicate findingKey");
  });

  it("rejects unexpected model fields", () => {
    expect(() => parseModelReview(JSON.stringify({ ...modelReview(), rawPrompt: "not allowed" }), context)).toThrow(
      "unexpected fields",
    );
  });

  it("extracts the final response from a read-only Copilot event stream", () => {
    const review = JSON.stringify(modelReview({ findings: [] }));
    const stream = [
      { type: "assistant.tool_call_delta", data: { toolName: "view" } },
      { type: "tool.execution_start", data: { toolName: "view" } },
      { type: "assistant.message", data: { content: "" } },
      { type: "assistant.message", data: { content: review } },
      { type: "result", exitCode: 0 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    expect(extractCopilotReview(stream)).toBe(review);
  });

  it("rejects a Copilot event stream that invokes a mutating tool", () => {
    const stream = [
      { type: "tool.execution_start", data: { toolName: "powershell" } },
      { type: "assistant.message", data: { content: JSON.stringify(modelReview()) } },
      { type: "result", exitCode: 0 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    expect(() => extractCopilotReview(stream)).toThrow("non-read-only tool");
  });
});
