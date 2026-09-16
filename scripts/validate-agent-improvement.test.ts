import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAgentImprovementArtifacts } from "./validate-agent-improvement.mjs";

const root = process.cwd();
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const ledger = readJson("docs/agent-findings/ledger.json");
const corpus = readJson("docs/agent-findings/learned-rules.json");
const dashboard = readJson("dashboards/candidate-active-retired-proof-pairs.json");

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

  it("rejects stale proof-pair and verified-control counts", () => {
    expect(() =>
      validateAgentImprovementArtifacts(
        ledger,
        corpus,
        { ...dashboard, proofPairCount: dashboard.proofPairCount + 1 },
        { root },
      ),
    ).toThrow("proof-pair count is stale");
    expect(() =>
      validateAgentImprovementArtifacts(
        ledger,
        corpus,
        { ...dashboard, verifiedControlCount: dashboard.verifiedControlCount + 1 },
        { root },
      ),
    ).toThrow("verified-control count is stale");
  });
  it("rejects unrelated regression tests and altered control bindings", () => {
    const unrelated = structuredClone(corpus);
    unrelated.rules[0].control.testPaths = ["scripts/check-repository-docs.test.ts"];
    expect(() => validateAgentImprovementArtifacts(ledger, unrelated, dashboard, { root })).toThrow(
      "proof-pair count is stale",
    );
    const changedDashboard = structuredClone(dashboard);
    changedDashboard.proofPairs[0].controlVersion = "9.9.9";
    expect(() => validateAgentImprovementArtifacts(ledger, corpus, changedDashboard, { root })).toThrow(
      "bindings are stale",
    );
  });
  it("reads the legacy v1 shape without treating it as v2 proof evidence", () => {
    const legacy = structuredClone(corpus);
    legacy.schemaVersion = 1;
    for (const rule of legacy.rules) {
      rule.promotedAt = rule.activatedAt ?? rule.proposedAt;
      rule.lastVerifiedAt ??= rule.promotedAt;
      delete rule.proposedAt;
      delete rule.activatedAt;
    }
    const legacyDashboard = structuredClone(dashboard);
    legacyDashboard.schemaVersion = 1;
    delete legacyDashboard.proofPairs;
    delete legacyDashboard.proofPairCount;
    delete legacyDashboard.verifiedControlCount;
    expect(validateAgentImprovementArtifacts(ledger, legacy, legacyDashboard, { root }).corpus).toEqual(legacy);
    expect(() =>
      validateAgentImprovementArtifacts(ledger, { ...corpus, schemaVersion: 1 }, legacyDashboard, { root }),
    ).toThrow("unexpected fields");
  });

  it("enforces candidate and retired lifecycle transitions", () => {
    const activatedCandidate = structuredClone(corpus);
    activatedCandidate.rules.find((rule: { id: string }) => rule.id === "ESP-LR-0005").activatedAt =
      "2026-09-16T05:00:00.000Z";
    expect(() => validateAgentImprovementArtifacts(ledger, activatedCandidate, dashboard, { root })).toThrow(
      "candidate cannot be activated",
    );

    const missingSuccessor = structuredClone(corpus);
    missingSuccessor.rules.find((rule: { id: string }) => rule.id === "ESP-LR-0004").supersededBy = "ESP-LR-9999";
    expect(() => validateAgentImprovementArtifacts(ledger, missingSuccessor, dashboard, { root })).toThrow(
      "successor must be an active rule",
    );
  });
});
