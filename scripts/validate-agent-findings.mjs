import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const statuses = new Set(["open", "accepted", "resolved", "risk_accepted", "false_positive"]);
const severities = new Set(["critical", "high", "medium", "low"]);

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: unexpected fields`);
}

function boundedString(value, minimum, maximum, label) {
  assert.equal(typeof value, "string", `${label}: expected string`);
  assert.ok(value.length >= minimum && value.length <= maximum, `${label}: invalid length`);
  return value;
}

function isoDate(value, label) {
  boundedString(value, 20, 30, label);
  const date = new Date(value);
  assert.ok(
    Number.isFinite(date.valueOf()) && date.toISOString() === value,
    `${label}: expected canonical UTC timestamp`,
  );
  return date;
}

function repositoryPath(value, root, label, requireExisting = false) {
  boundedString(value, 1, 240, label);
  assert.ok(!isAbsolute(value) && !value.includes("\\"), `${label}: expected forward-slash repository path`);
  const absolute = resolve(root, value);
  const traversal = relative(root, absolute);
  assert.ok(traversal && !traversal.startsWith("..") && !isAbsolute(traversal), `${label}: path escapes repository`);
  if (requireExisting) assert.ok(existsSync(absolute), `${label}: referenced path does not exist`);
  return value;
}

export function validateAgentFindingsLedger(value, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Ledger must be an object");
  exactKeys(value, ["schemaVersion", "kind", "nextSequence", "findings"], "ledger");
  assert.equal(value.schemaVersion, 1, "Unsupported ledger schema version");
  assert.equal(value.kind, "esp-agent-findings-ledger", "Unexpected ledger kind");
  assert.ok(Number.isInteger(value.nextSequence) && value.nextSequence >= 1, "Invalid nextSequence");
  assert.ok(Array.isArray(value.findings) && value.findings.length <= 500, "Invalid findings collection");

  const identifiers = new Set();
  const fingerprints = new Set();
  let maximumSequence = 0;

  for (const finding of value.findings) {
    assert.ok(finding && typeof finding === "object" && !Array.isArray(finding), "Finding must be an object");
    exactKeys(
      finding,
      [
        "id",
        "fingerprint",
        "title",
        "severity",
        "area",
        "path",
        "owner",
        "status",
        "firstSeenAt",
        "lastSeenAt",
        "recurrenceCount",
        "occurrences",
        "dispositionReason",
        "proofOfFix",
        "promotedControl",
        "riskExpiresAt",
      ],
      "finding",
    );

    const idMatch = /^ESP-AF-(\d{4})$/.exec(finding.id);
    assert.ok(idMatch, "Invalid finding ID");
    const sequence = Number(idMatch[1]);
    assert.ok(sequence >= 1 && !identifiers.has(finding.id), `Duplicate or invalid finding ID: ${finding.id}`);
    identifiers.add(finding.id);
    maximumSequence = Math.max(maximumSequence, sequence);

    assert.match(finding.fingerprint, digestPattern, `${finding.id}: invalid fingerprint`);
    assert.ok(!fingerprints.has(finding.fingerprint), `${finding.id}: duplicate fingerprint`);
    fingerprints.add(finding.fingerprint);
    boundedString(finding.title, 8, 160, `${finding.id}.title`);
    assert.ok(severities.has(finding.severity), `${finding.id}: invalid severity`);
    assert.match(finding.area, /^[a-z][a-z0-9-]{1,79}$/, `${finding.id}: invalid area`);
    repositoryPath(finding.path, root, `${finding.id}.path`);
    assert.match(finding.owner, /^(?:unassigned|@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/, `${finding.id}: invalid owner`);
    assert.ok(statuses.has(finding.status), `${finding.id}: invalid status`);

    const firstSeen = isoDate(finding.firstSeenAt, `${finding.id}.firstSeenAt`);
    const lastSeen = isoDate(finding.lastSeenAt, `${finding.id}.lastSeenAt`);
    assert.ok(firstSeen <= lastSeen, `${finding.id}: invalid seen range`);
    assert.ok(
      Array.isArray(finding.occurrences) && finding.occurrences.length >= 1 && finding.occurrences.length <= 50,
      `${finding.id}: invalid occurrences`,
    );
    assert.equal(finding.recurrenceCount, finding.occurrences.length, `${finding.id}: recurrenceCount mismatch`);

    const occurrenceKeys = new Set();
    const observedDates = [];
    for (const occurrence of finding.occurrences) {
      exactKeys(occurrence, ["reviewRunId", "targetSha", "observedAt", "evidenceDigest"], `${finding.id}.occurrence`);
      assert.match(occurrence.reviewRunId, /^\d+$/, `${finding.id}: invalid review run ID`);
      assert.match(occurrence.targetSha, shaPattern, `${finding.id}: invalid target SHA`);
      assert.match(occurrence.evidenceDigest, digestPattern, `${finding.id}: invalid evidence digest`);
      observedDates.push(isoDate(occurrence.observedAt, `${finding.id}.observedAt`));
      const occurrenceKey = `${occurrence.reviewRunId}:${occurrence.targetSha}:${occurrence.evidenceDigest}`;
      assert.ok(!occurrenceKeys.has(occurrenceKey), `${finding.id}: duplicate occurrence`);
      occurrenceKeys.add(occurrenceKey);
    }
    const observedTimes = observedDates.map((date) => date.valueOf());
    assert.equal(firstSeen.valueOf(), Math.min(...observedTimes), `${finding.id}: firstSeenAt mismatch`);
    assert.equal(lastSeen.valueOf(), Math.max(...observedTimes), `${finding.id}: lastSeenAt mismatch`);

    boundedString(
      finding.dispositionReason,
      finding.status === "open" ? 0 : 8,
      1000,
      `${finding.id}.dispositionReason`,
    );
    if (["accepted", "resolved", "risk_accepted"].includes(finding.status)) {
      assert.notEqual(finding.owner, "unassigned", `${finding.id}: accepted finding needs an owner`);
    }

    if (finding.status === "resolved") {
      assert.ok(
        finding.proofOfFix && typeof finding.proofOfFix === "object",
        `${finding.id}: resolved finding needs proofOfFix`,
      );
      exactKeys(finding.proofOfFix, ["commitSha", "checks", "testPaths"], `${finding.id}.proofOfFix`);
      assert.match(finding.proofOfFix.commitSha, shaPattern, `${finding.id}: invalid proof commit`);
      assert.ok(
        Array.isArray(finding.proofOfFix.checks) &&
          finding.proofOfFix.checks.length >= 1 &&
          finding.proofOfFix.checks.length <= 20,
        `${finding.id}: invalid proof checks`,
      );
      for (const check of finding.proofOfFix.checks) boundedString(check, 2, 160, `${finding.id}.proofCheck`);
      assert.ok(
        Array.isArray(finding.proofOfFix.testPaths) &&
          finding.proofOfFix.testPaths.length >= 1 &&
          finding.proofOfFix.testPaths.length <= 20,
        `${finding.id}: invalid proof testPaths`,
      );
      for (const path of finding.proofOfFix.testPaths) repositoryPath(path, root, `${finding.id}.testPath`, true);
    } else {
      assert.equal(finding.proofOfFix, null, `${finding.id}: only resolved findings may contain proofOfFix`);
    }

    if (finding.promotedControl !== null) {
      assert.equal(finding.status, "resolved", `${finding.id}: promoted control must be resolved`);
      assert.ok(finding.recurrenceCount >= 2, `${finding.id}: promotion requires at least two occurrences`);
      exactKeys(finding.promotedControl, ["kind", "path", "version"], `${finding.id}.promotedControl`);
      assert.ok(
        ["test", "lint", "contract", "instruction"].includes(finding.promotedControl.kind),
        `${finding.id}: invalid control kind`,
      );
      repositoryPath(finding.promotedControl.path, root, `${finding.id}.controlPath`, true);
      assert.match(finding.promotedControl.version, /^\d+\.\d+\.\d+$/, `${finding.id}: invalid control version`);
    }

    if (finding.status === "risk_accepted") {
      const expiration = isoDate(finding.riskExpiresAt, `${finding.id}.riskExpiresAt`);
      assert.ok(expiration > lastSeen, `${finding.id}: risk acceptance must expire after last occurrence`);
    } else {
      assert.equal(finding.riskExpiresAt, null, `${finding.id}: unexpected risk expiration`);
    }
  }

  assert.ok(value.nextSequence > maximumSequence, "nextSequence must exceed all finding IDs");
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ledgerPath = resolve(process.argv[2] ?? "docs/agent-findings/ledger.json");
  validateAgentFindingsLedger(JSON.parse(readFileSync(ledgerPath, "utf8")), {
    root: resolve(import.meta.dirname, ".."),
  });
  console.log(`agent-findings: valid ${ledgerPath}`);
}
