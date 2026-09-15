import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const previews = process.argv.includes("--previews");
const writeLifecycle = process.argv.includes("--ticket-lifecycle");
assert.ok(!writeLifecycle || previews, "--ticket-lifecycle requires --previews");
const pack = JSON.parse(await readFile(new URL("../src/data/enterprise-pack.json", import.meta.url), "utf8"));

async function api(path, body, parent) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(65_000),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(parent?.id ? { "x-esp-parent-audit-id": parent.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  assert.equal(response.status, 200, `${path}: ${result?.error ?? response.status} (${result?.requestId ?? result?.audit?.requestId ?? "no request ID"})`);
  assert.ok(result, `${path}: missing JSON result`);
  return result;
}

const library = await api("/api/knowledge");
assert.equal(library.builtins.length, pack.documents.length);
assert.deepEqual(library.builtins.map((document) => document.id).sort(), pack.documents.map((document) => document.id).sort());
assert.ok(library.builtins.every((document) => document.version === pack.version));
const catalog = await api("/api/skills");
assert.equal(catalog.skills.length, 7);
assert.equal(catalog.skills.flatMap((skill) => skill.sources).length, 100);
const plugins = await api("/api/plugins");
assert.equal(plugins.plugins.length, 2);
const knowledge = plugins.plugins.find((plugin) => plugin.id === "knowledge").operations[0];
assert.equal(knowledge.examples.length, 46);
for (const record of new Map(pack.records.map((record) => [record.kind, record])).values()) {
  const source = await api(`/api/knowledge/${record.sourceId}`);
  const canonical = pack.documents.find((document) => document.id === record.sourceId);
  assert.equal(source.content, canonical.content, `${record.id}: displayed evidence differs from the linked data`);
  assert.equal(source.entry.dataKind, "snapshot"); assert.equal(source.entry.status, "published"); assert.equal(source.canManage, false);
  assert.equal(source.chunks[0].content, canonical.content);
  const page = await fetch(new URL(`/knowledge/${record.sourceId}`, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  assert.equal(page.status, 200); assert.ok((await page.text()).includes(record.id));
  console.log(`PASS ${record.kind}: ${record.id}, canonical snapshot and source page`);
}
console.log(`Enterprise data read passed: ${pack.records.length} linked records, ${pack.documents.length} sources, 46 knowledge scenarios`);

if (previews) {
  const baseline = await api("/api/tickets");
  const requests = pack.records.filter((record) => record.action);
  assert.equal(requests.length, 6);
  let firstPreview;
  for (const record of requests) {
    const { action } = record;
    const preview = await api("/api/plugins/tickets/trial", { operationId: "tickets.create", skillId: action.skillId, input: { query: action.query, parameters: action.parameters } });
    assert.equal(preview.mode, "write_preview"); assert.equal(preview.status, "waiting_confirmation"); assert.equal(preview.execution, null);
    assert.equal(preview.preview.confirmed, false); assert.deepEqual(preview.preview.parameters, action.parameters);
    const handoff = await api("/api/route", preview.preview, preview.audit);
    assert.equal(handoff.executionStatus, "waiting_confirmation"); assert.equal(handoff.execution, null);
    assert.equal(handoff.policy.effect, action.parameters.impact === "individual" ? "confirmation" : "approval");
    firstPreview ??= { preview: preview.preview, audit: handoff.audit, confirmation: handoff.confirmation };
    console.log(`PASS ${record.id}: ${action.parameters.impact} impact, preview only`);
  }
  const afterPreview = await api("/api/tickets");
  assert.deepEqual(afterPreview.tickets.map((ticket) => ticket.id).sort(), baseline.tickets.map((ticket) => ticket.id).sort(), "Ticket set changed during preview-only acceptance");
  if (baseline.tickets[0]) {
    const ticket = baseline.tickets[0];
    const actual = await api("/api/plugins/tickets/trial", { operationId: "tickets.get", skillId: "get-ticket-status", input: { query: `查询工单状态 ${ticket.id}`, parameters: { ticketId: ticket.id } } });
    assert.equal(actual.status, "completed"); assert.deepEqual(actual.execution.ticket, ticket);
    console.log(`PASS actual saved receipt lookup: ${ticket.id}`);
  }
  if (writeLifecycle) {
    assert.ok(firstPreview.confirmation?.id, "Server confirmation is required");
    const created = await api("/api/route", { ...firstPreview.preview, confirmed: true, confirmationId: firstPreview.confirmation.id }, firstPreview.audit);
    assert.equal(created.executionStatus, "completed"); assert.equal(created.execution.type, "ticket_created");
    const ticket = created.execution.ticket;
    assert.deepEqual(ticket.details, requests[0].action.parameters);
    const readback = await api("/api/plugins/tickets/trial", { operationId: "tickets.get", skillId: "get-ticket-status", input: { query: `查询工单状态 ${ticket.id}`, parameters: { ticketId: ticket.id } } }, created.audit);
    assert.deepEqual(readback.execution.ticket, ticket);
    console.log(`PASS explicit realistic DEV ticket: ${ticket.id}; retained for the saved-receipt picker`);
  }
}