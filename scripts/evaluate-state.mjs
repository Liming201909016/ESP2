import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const inspectTarget = process.argv.includes("--target");
function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith("--"), `${name} requires a file path`);
  return value;
}
const capturePath = argument("--capture");
const verifyPath = argument("--verify");
assert.ok(!(capturePath && verifyPath), "Capture and verify are separate operations");

async function api(path) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(65_000) });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, 200, `${path}: ${body?.error ?? response.status}${body?.sqlState ? ` (${body.sqlState})` : ""}${body?.connectionCode ? ` (${body.connectionCode})` : ""}${body?.configuration ? ` missing ${body.configuration.join(",")}` : ""}`);
  assert.ok(body, "Expected a JSON response"); return body;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function fingerprint(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }

const status = await api(`/api/state${inspectTarget ? "?target=postgres" : ""}`);
if (inspectTarget) {
  assert.equal(status.postgres?.reachable, true);
  console.log(`PostgreSQL target reachable; prepared=${status.postgres.prepared}; active backend=${status.backend}; writesPaused=${status.writesPaused}`);
} else if (!capturePath) {
  assert.equal(status.backend, "postgres"); assert.equal(status.postgres?.prepared, true); assert.equal(status.postgres.schemaVersion, 1);
  assert.ok(status.postgres.lastMigration, "DEV migration manifest missing");
  console.log(`PostgreSQL active: ${status.postgres.counts.tickets} owned tickets, ${status.postgres.counts.approvals} owned approvals; writesPaused=${status.writesPaused}`);
}

if (capturePath) {
  assert.equal(status.backend, "blob", "Capture must use the original Blob backend");
  assert.equal(status.writesPaused, true, "Capture requires paused state writes");
  const receipts = await api("/api/tickets");
  const tickets = receipts.tickets.map((ticket) => ({ id: ticket.id, digest: fingerprint(ticket) }));
  const approvals = [];
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const result = await api(`/api/approvals${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`);
    for (const entry of result.approvals) {
      const detail = await api(`/api/approvals/${entry.id}`);
      approvals.push({ id: detail.record.id, digest: fingerprint(detail.record) });
    }
    if (!result.nextCursor) { cursor = null; break; }
    cursor = result.nextCursor;
  }
  assert.equal(cursor, null, "Approval capture exceeded its bounded page count");
  assert.equal(new Set(approvals.map((entry) => entry.id)).size, approvals.length);
  await writeFile(capturePath, JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), tickets, approvals }, null, 2), { encoding: "utf8", flag: "wx" });
  console.log(`Baseline captured: ${tickets.length} listed owned tickets and ${approvals.length} owned approvals; identifiers/digests only`);
}

if (verifyPath) {
  assert.equal(status.backend, "postgres"); assert.equal(status.writesPaused, true, "Verify before reopening writes");
  const baseline = JSON.parse(await readFile(verifyPath, "utf8"));
  assert.equal(baseline.version, 1);
  for (const entry of baseline.tickets) {
    const response = await fetch(new URL("/api/plugins/tickets/trial", baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "Verify migrated owned receipt", parameters: { ticketId: entry.id } } }), signal: AbortSignal.timeout(65_000) });
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.execution?.type, "ticket_status");
    assert.equal(fingerprint(result.execution.ticket), entry.digest, `Migrated ticket differs: ${entry.id}`);
  }
  for (const entry of baseline.approvals) {
    const detail = await api(`/api/approvals/${entry.id}`);
    assert.match(detail.etag, /^pg:[1-9]\d*$/);
    assert.equal(fingerprint(detail.record), entry.digest, `Migrated approval differs: ${entry.id}`);
  }
  console.log(`Migration readback passed: ${baseline.tickets.length} ticket receipts and ${baseline.approvals.length} approval snapshots match`);
}