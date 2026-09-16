import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAgentFindingsLedger } from "./validate-agent-findings.mjs";

const ruleStatuses = ["candidate", "active", "retired"];
const findingStatuses = ["open", "accepted", "resolved", "risk_accepted", "false_positive"];

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: unexpected fields`);
}

function repositoryFile(root, path, label) {
  assert.equal(typeof path, "string", `${label}: expected path`);
  assert.ok(path && !isAbsolute(path) && !path.includes("\\"), `${label}: invalid repository path`);
  const absolute = resolve(root, path);
  const traversal = relative(root, absolute);
  assert.ok(traversal && !traversal.startsWith("..") && !isAbsolute(traversal), `${label}: path escapes repository`);
  assert.ok(existsSync(absolute), `${label}: referenced path does not exist`);
  return path;
}

function canonicalDate(value, label) {
  assert.equal(typeof value, "string", `${label}: expected timestamp`);
  const date = new Date(value);
  assert.ok(Number.isFinite(date.valueOf()) && date.toISOString() === value, `${label}: invalid timestamp`);
  return date;
}

export function validateAgentImprovementArtifacts(ledger, corpus, dashboard, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  validateAgentFindingsLedger(ledger, { root });
  exactKeys(corpus, ["schemaVersion", "kind", "nextSequence", "rules"], "learnedRules");
  assert.equal(corpus.schemaVersion, 1, "Unsupported learned-rules schema");
  assert.equal(corpus.kind, "esp-agent-learned-rules", "Unexpected learned-rules kind");
  assert.ok(Array.isArray(corpus.rules) && corpus.rules.length <= 100, "Invalid learned-rules collection");

  const findings = new Map(ledger.findings.map((finding) => [finding.id, finding]));
  const ruleIds = new Set();
  const coveredFindingIds = new Set();
  let maximumSequence = 0;
  for (const rule of corpus.rules) {
    exactKeys(
      rule,
      [
        "id",
        "status",
        "title",
        "description",
        "sourceFindingIds",
        "owner",
        "control",
        "promotedAt",
        "lastVerifiedAt",
        "retiredAt",
        "supersededBy",
      ],
      "learnedRule",
    );
    const idMatch = /^ESP-LR-(\d{4})$/u.exec(rule.id);
    assert.ok(idMatch && !ruleIds.has(rule.id), `Invalid or duplicate learned-rule ID: ${rule.id}`);
    ruleIds.add(rule.id);
    maximumSequence = Math.max(maximumSequence, Number(idMatch[1]));
    assert.ok(ruleStatuses.includes(rule.status), `${rule.id}: invalid status`);
    assert.match(rule.title, /^.{8,160}$/u, `${rule.id}: invalid title`);
    assert.match(rule.description, /^.{20,1000}$/u, `${rule.id}: invalid description`);
    assert.match(rule.owner, /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u, `${rule.id}: invalid owner`);
    assert.ok(
      Array.isArray(rule.sourceFindingIds) && rule.sourceFindingIds.length >= (rule.status === "candidate" ? 1 : 2),
      `${rule.id}: active or retired rules require multiple source findings`,
    );
    assert.equal(
      new Set(rule.sourceFindingIds).size,
      rule.sourceFindingIds.length,
      `${rule.id}: duplicate source finding`,
    );
    let latestSource = new Date(0);
    for (const findingId of rule.sourceFindingIds) {
      const finding = findings.get(findingId);
      assert.ok(finding, `${rule.id}: unknown source finding ${findingId}`);
      assert.equal(finding.status, "resolved", `${rule.id}: source finding must be resolved: ${findingId}`);
      assert.ok(!coveredFindingIds.has(findingId), `${findingId}: assigned to multiple learned rules`);
      coveredFindingIds.add(findingId);
      latestSource = new Date(Math.max(latestSource.valueOf(), new Date(finding.lastSeenAt).valueOf()));
    }
    exactKeys(rule.control, ["kind", "path", "version", "testPaths"], `${rule.id}.control`);
    assert.ok(
      ["test", "lint", "contract", "instruction"].includes(rule.control.kind),
      `${rule.id}: invalid control kind`,
    );
    repositoryFile(root, rule.control.path, `${rule.id}.control.path`);
    assert.match(rule.control.version, /^\d+\.\d+\.\d+$/u, `${rule.id}: invalid control version`);
    assert.ok(
      Array.isArray(rule.control.testPaths) && rule.control.testPaths.length >= 1,
      `${rule.id}: tests required`,
    );
    for (const path of rule.control.testPaths) repositoryFile(root, path, `${rule.id}.control.testPath`);
    const promotedAt = canonicalDate(rule.promotedAt, `${rule.id}.promotedAt`);
    const lastVerifiedAt = canonicalDate(rule.lastVerifiedAt, `${rule.id}.lastVerifiedAt`);
    assert.ok(promotedAt >= latestSource, `${rule.id}: promotion predates source evidence`);
    assert.ok(lastVerifiedAt >= promotedAt, `${rule.id}: verification predates promotion`);
    if (rule.status === "retired") {
      const retiredAt = canonicalDate(rule.retiredAt, `${rule.id}.retiredAt`);
      assert.ok(retiredAt >= lastVerifiedAt, `${rule.id}: retirement predates verification`);
      assert.ok(
        rule.supersededBy === null || /^ESP-LR-\d{4}$/u.test(rule.supersededBy),
        `${rule.id}: invalid successor`,
      );
    } else {
      assert.equal(rule.retiredAt, null, `${rule.id}: unexpected retirement timestamp`);
      assert.equal(rule.supersededBy, null, `${rule.id}: unexpected successor`);
    }
  }
  assert.ok(corpus.nextSequence > maximumSequence, "nextSequence must exceed all learned-rule IDs");

  exactKeys(
    dashboard,
    [
      "schemaVersion",
      "kind",
      "findingCount",
      "findingStatusCounts",
      "learnedRuleStatusCounts",
      "coveredFindingCount",
      "proofPairCount",
      "verifiedControlCount",
      "coveragePercent",
      "uncoveredFindingIds",
    ],
    "improvementDashboard",
  );
  assert.equal(dashboard.schemaVersion, 1, "Unsupported improvement dashboard schema");
  assert.equal(dashboard.kind, "esp-agent-improvement-dashboard", "Unexpected improvement dashboard kind");
  const findingStatusCounts = Object.fromEntries(
    findingStatuses.map((status) => [status, ledger.findings.filter((finding) => finding.status === status).length]),
  );
  const learnedRuleStatusCounts = Object.fromEntries(
    ruleStatuses.map((status) => [status, corpus.rules.filter((rule) => rule.status === status).length]),
  );
  const uncoveredFindingIds = ledger.findings.map((finding) => finding.id).filter((id) => !coveredFindingIds.has(id));
  assert.equal(dashboard.findingCount, ledger.findings.length, "Dashboard finding count is stale");
  assert.deepEqual(dashboard.findingStatusCounts, findingStatusCounts, "Dashboard finding status counts are stale");
  assert.deepEqual(dashboard.learnedRuleStatusCounts, learnedRuleStatusCounts, "Dashboard rule counts are stale");
  assert.equal(dashboard.coveredFindingCount, coveredFindingIds.size, "Dashboard covered count is stale");
  const proofPairCount = [...coveredFindingIds].filter((id) => findings.get(id)?.proofOfFix !== null).length;
  const verifiedControlCount = corpus.rules.filter((rule) => rule.status === "active").length;
  assert.equal(dashboard.proofPairCount, proofPairCount, "Dashboard proof-pair count is stale");
  assert.equal(dashboard.verifiedControlCount, verifiedControlCount, "Dashboard verified-control count is stale");
  assert.equal(
    dashboard.coveragePercent,
    Math.round((coveredFindingIds.size / Math.max(ledger.findings.length, 1)) * 1000) / 10,
    "Dashboard coverage is stale",
  );
  assert.deepEqual(dashboard.uncoveredFindingIds, uncoveredFindingIds, "Dashboard uncovered findings are stale");
  return { ledger, corpus, dashboard };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, "..");
  const ledger = JSON.parse(readFileSync(resolve(root, "docs/agent-findings/ledger.json"), "utf8"));
  const corpus = JSON.parse(readFileSync(resolve(root, "docs/agent-findings/learned-rules.json"), "utf8"));
  const dashboard = JSON.parse(
    readFileSync(resolve(root, "dashboards/governed-learned-rule-proof-pairs.json"), "utf8"),
  );
  validateAgentImprovementArtifacts(ledger, corpus, dashboard, { root });
  console.log(
    `agent-improvement: ${corpus.rules.length} learned rules cover ${dashboard.coveredFindingCount} findings`,
  );
}
