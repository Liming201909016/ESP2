import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const runTrials = process.argv.includes("--trials");
const writeLifecycle = process.argv.includes("--ticket-lifecycle");
assert.ok(!writeLifecycle || runTrials, "--ticket-lifecycle requires --trials");

async function api(path, body, expectedStatus = 200) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json().catch(() => null);
  assert.equal(response.status, expectedStatus, `${path}: ${result?.error ?? response.status}${result?.requestId ? ` (${result.requestId})` : ""}`);
  assert.ok(result, `${path}: missing JSON result`);
  if (path.startsWith("/api/plugins")) assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  return result;
}

const catalog = await api("/api/plugins");
assert.deepEqual(catalog.plugins.map((plugin) => plugin.id), ["knowledge", "tickets"]);
assert.ok(!Number.isNaN(Date.parse(catalog.generatedAt)));
let operationCount = 0;
for (const plugin of catalog.plugins) {
  assert.equal(plugin.runtime, "builtin");
  assert.equal(plugin.state, "registered");
  assert.equal(plugin.contractVersion, "1.0");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  for (const dependency of plugin.dependencies) {
    assert.equal(dependency.health, "not_checked");
    assert.equal(dependency.configured, dependency.requiredSettings.every((setting) => setting.present));
    for (const setting of dependency.requiredSettings) assert.deepEqual(Object.keys(setting).sort(), ["name", "present"]);
  }
  for (const operation of plugin.operations) {
    operationCount += 1;
    assert.ok(operation.skills.length && operation.examples.length);
    assert.equal(operation.inputSchema.additionalProperties, false);
    assert.ok(operation.outputSchema.oneOf || operation.outputSchema.anyOf);
    assert.equal(operation.trialMode, operation.effect === "write" ? "write_preview" : "live_read");
  }
}
assert.equal(operationCount, 3);
console.log("Plugin catalog passed: 2 built-ins, 3 operation contracts, no runtime calls");

if (runTrials) {
  const sourceCache = new Map();
  async function trial(pluginId, operationId, skillId, input) {
    const result = await api(`/api/plugins/${pluginId}/trial`, { operationId, skillId, input });
    assert.equal(result.pluginId, pluginId);
    assert.equal(result.operationId, operationId);
    assert.equal(result.skillId, skillId);
    assert.match(result.requestId, /^[a-f0-9-]{36}$/);
    assert.ok(result.durationMs >= 0 && Date.parse(result.completedAt) >= Date.parse(result.startedAt));
    assert.ok(result.trace.some((step) => step.step === "permissions.allowed"));
    assert.notEqual(result.execution?.type, "ticket_created", "Plugin trials must not create tickets");
    return result;
  }

  const knowledge = catalog.plugins.find((plugin) => plugin.id === "knowledge").operations[0];
  for (const skill of knowledge.skills) {
    const example = knowledge.examples.find((entry) => entry.skillId === skill.id);
    const result = await trial("knowledge", knowledge.id, skill.id, example.input);
    assert.equal(result.mode, "live_read");
    assert.equal(result.status, "completed");
    assert.equal(result.execution.type, "knowledge_answer");
    assert.ok(result.execution.answer.trim() && result.execution.citations.length);
    for (const citation of result.execution.citations) {
      assert.match(citation.url, /^\/knowledge\/(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32}-c\d{3})$/);
      const documentId = citation.id.replace(/-c\d{3}$/, "");
      if (!sourceCache.has(documentId)) sourceCache.set(documentId, await api(`/api/knowledge/${documentId}`));
      const document = sourceCache.get(documentId);
      assert.equal(document.entry.status, "published");
      assert.equal(document.entry.documentNumber, citation.documentNumber);
      assert.ok(document.chunks.some((chunk) => chunk.id === citation.id && chunk.content.includes(citation.excerpt)), "Quotation is not exact published evidence");
      const page = await fetch(new URL(citation.url, baseUrl), { signal: AbortSignal.timeout(20_000), redirect: "manual" });
      assert.equal(page.status, 200, "Citation source page unavailable");
    }
    console.log(`PASS knowledge.answer: ${skill.id}, grounded citations`);
  }

  const missing = await trial("tickets", "tickets.get", "get-ticket-status", { query: "Query ticket status" });
  assert.equal(missing.status, "needs_input");
  const missingId = `ESP-20260910-${randomUUID().slice(0, 8).toUpperCase()}`;
  const notFound = await trial("tickets", "tickets.get", "get-ticket-status", { query: "Query synthetic ticket status", parameters: { ticketId: missingId } });
  assert.equal(notFound.status, "not_found");
  console.log("PASS tickets.get: missing input and absent owned record");

  const marker = `PLUGIN-TEST-${randomUUID()}`;
  const input = { query: `Create a simulated ticket ${marker}`, parameters: { description: `Synthetic VPN failure ${marker}`, impact: "individual", device: "SIM-PLUGIN-TEST" } };
  const preview = await trial("tickets", "tickets.create", "create-it-ticket", input);
  assert.equal(preview.mode, "write_preview");
  assert.equal(preview.status, "waiting_confirmation");
  assert.equal(preview.execution, null);
  assert.equal(preview.preview.confirmed, false);
  assert.deepEqual(preview.preview.parameters, input.parameters);
  assert.ok(preview.trace.some((step) => step.step === "trial.write_not_executed"));
  await api("/api/plugins/tickets/trial", { operationId: "tickets.create", skillId: "create-it-ticket", input, confirmed: true }, 400);
  const awaiting = await api("/api/route", preview.preview);
  assert.equal(awaiting.executionStatus, "waiting_confirmation");
  assert.equal(awaiting.execution, null);
  const records = await api("/api/tickets");
  assert.ok(!records.tickets.some((ticket) => ticket.summary.includes(marker)), "Preview unexpectedly persisted a ticket");
  console.log("PASS tickets.create: preview and workbench handoff, no write");

  if (records.tickets[0]) {
    const ticket = records.tickets[0];
    const lookup = await trial("tickets", "tickets.get", "get-ticket-status", { query: "Query existing owned ticket", parameters: { ticketId: ticket.id } });
    assert.equal(lookup.status, "completed");
    assert.deepEqual(lookup.execution.ticket, ticket);
    console.log("PASS tickets.get: existing owned record matches execution ledger");
  }
  if (writeLifecycle) {
    assert.ok(awaiting.confirmation?.id, "Server confirmation is required");
    const created = await api("/api/route", { ...preview.preview, confirmed: true, confirmationId: awaiting.confirmation.id });
    assert.equal(created.executionStatus, "completed");
    assert.equal(created.execution.type, "ticket_created");
    const ticket = created.execution.ticket;
    assert.deepEqual(ticket.details, input.parameters);
    const readback = await trial("tickets", "tickets.get", "get-ticket-status", { query: "Query synthetic plugin acceptance ticket", parameters: { ticketId: ticket.id } });
    assert.deepEqual(readback.execution.ticket, ticket);
    console.log(`PASS explicit ticket lifecycle: ${ticket.id}, simulated record retained`);
  }
  console.log(`Plugin trial acceptance passed${writeLifecycle ? "; one explicitly confirmed simulated ticket created" : "; no ticket writes"}`);
}