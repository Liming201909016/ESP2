import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAgentImprovementArtifacts } from "./validate-agent-improvement.mjs";

const root = process.cwd();
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const ledger = readJson("docs/agent-findings/ledger.json");
const corpus = readJson("docs/agent-findings/learned-rules.json");
const dashboard = readJson("dashboards/agent-improvement.json");

describe("agent improvement artifacts", () => {
  it("accepts the current learned-rule lifecycle and dashboard", () => {
    expect(validateAgentImprovementArtifacts(ledger, corpus, dashboard, { root }).dashboard).toEqual(dashboard);
  });

  it("requires multiple resolved findings before activation", () => {
    const changed = structuredClone(corpus);
    changed.rules[0].sourceFindingIds = [changed.rules[0].sourceFindingIds[0]];
    expect(() => validateAgentImprovementArtifacts(ledger, changed, dashboard, { root })).toThrow(
      "require multiple source findings",
    );
  });

  it("rejects active rules backed by unresolved findings", () => {
    const changedLedger = structuredClone(ledger);
    const sourceId = corpus.rules[0].sourceFindingIds[0];
    const source = changedLedger.findings.find((finding: { id: string }) => finding.id === sourceId);
    source.status = "open";
    source.owner = "unassigned";
    source.dispositionReason = "";
    source.proofOfFix = null;
    expect(() => validateAgentImprovementArtifacts(changedLedger, corpus, dashboard, { root })).toThrow(
      "source finding must be resolved",
    );
  });

  it("rejects stale dashboard coverage", () => {
    expect(() =>
      validateAgentImprovementArtifacts(ledger, corpus, { ...dashboard, coveredFindingCount: 25 }, { root }),
    ).toThrow("covered count is stale");
  });
});
