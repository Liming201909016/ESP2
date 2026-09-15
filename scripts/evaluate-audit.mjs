import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const lifecycle = process.argv.includes("--lifecycle");
const forbiddenText = `AUDIT-PRIVATE-${randomUUID()}`;

async function api(path, body, parent, statuses = [200]) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(parent?.id ? { "x-esp-parent-audit-id": parent.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json().catch(() => null);
  assert.ok(statuses.includes(response.status), `${path}: HTTP ${response.status} ${result?.error ?? ""}`);
  assert.ok(result, `${path}: missing JSON`);
  return { body: result, status: response.status, headers: response.headers };
}

async function auditOf(response, expectedStatus, parent) {
  const receipt = response.body.audit;
  assert.equal(receipt?.status, "recorded", `Audit is ${receipt?.status ?? "missing"}`);
  assert.match(receipt.id, /^aud-\d{13}-[a-f0-9]{32}$/);
  assert.equal(response.headers.get("x-esp-audit-id"), receipt.id);
  const stored = (await api(`/api/audit/${receipt.id}`)).body;
  assert.equal(stored.start.requestId, receipt.requestId);
  assert.equal(stored.start.traceId, receipt.traceId);
  assert.equal(stored.result.httpStatus, response.status);
  assert.equal(stored.result.status, expectedStatus);
  assert.equal(stored.start.actor.subject, "development:local");
  assert.ok(stored.result.durationMs >= 0);
  assert.ok(!JSON.stringify(stored).includes(forbiddenText), "Audit contains input text");
  if (parent) { assert.equal(stored.start.parentId, parent.id); assert.equal(stored.start.traceId, parent.traceId); }
  return { receipt, stored };
}

async function traceRecords(traceId, expectedIds) {
  const records = [];
  let cursor;
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ traceId, ...(cursor ? { cursor } : {}) });
    const result = (await api(`/api/audit?${query}`)).body;
    assert.ok(result.records.length <= 20);
    records.push(...result.records);
    if (expectedIds.every((id) => records.some((record) => record.start.id === id)) || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  assert.ok(expectedIds.every((id) => records.some((record) => record.start.id === id)), "Audit trace did not contain all expected requests within five pages");
  assert.ok(records.every((record) => record.start.traceId === traceId));
  const ids = records.map((record) => record.start.id);
  assert.deepEqual(ids, [...ids].sort(), "Audit starts are not ordered newest-first");
  return records;
}

const list = await api("/api/audit");
assert.match(list.headers.get("cache-control") ?? "", /private, no-store/);
assert.ok(Array.isArray(list.body.records) && list.body.records.length <= 20);
for (const record of list.body.records) {
  assert.equal(record.start.schemaVersion, 1);
  assert.ok(record.result === null || record.result.id === record.start.id);
}
console.log(`Audit read contract passed: ${list.body.records.length} accessible records on the first page`);

if (lifecycle) {
  let approval;
  let document;
  try {
    const query = `Create a simulated team incident ${forbiddenText}`;
    const parameters = { description: `Synthetic VPN outage ${forbiddenText}`, impact: "team" };
    const trial = await api("/api/plugins/tickets/trial", { operationId: "tickets.create", skillId: "create-it-ticket", input: { query, parameters } });
    const trialAudit = await auditOf(trial, "waiting_confirmation");
    assert.equal(trialAudit.stored.start.mutation, false);
    assert.equal(trialAudit.stored.start.input.queryHash, createHash("sha256").update(query).digest("hex"));
    const preview = await api("/api/route", trial.body.preview, trialAudit.receipt);
    const previewAudit = await auditOf(preview, "waiting_confirmation", trialAudit.receipt);
    assert.ok(previewAudit.stored.result.trace.some((step) => step.step === "policy.approval_required"));
    const submit = await api("/api/route", { ...trial.body.preview, confirmed: true, submissionId: randomUUID() }, previewAudit.receipt);
    approval = submit.body.approval;
    const submitAudit = await auditOf(submit, "waiting_approval", previewAudit.receipt);
    assert.equal(submitAudit.stored.start.mutation, true);
    assert.ok(submitAudit.stored.result.references.some((reference) => reference.type === "approval" && reference.id === approval.record.id));
    const approved = await api(`/api/approvals/${approval.record.id}`, { action: "approve", etag: approval.etag, reason: `DEV synthetic audit review ${forbiddenText}` }, submitAudit.receipt);
    approval = approved.body;
    const approvedAudit = await auditOf(approved, "approved", submitAudit.receipt);
    const executed = await api(`/api/approvals/${approval.record.id}`, { action: "execute", etag: approval.etag }, approvedAudit.receipt);
    approval = executed.body;
    const executedAudit = await auditOf(executed, "completed", approvedAudit.receipt);
    assert.equal(approval.record.ticket.approvalId, approval.record.id);
    assert.ok(executedAudit.stored.result.references.some((reference) => reference.type === "ticket" && reference.id === approval.record.ticket.id));
    const lookup = await api("/api/plugins/tickets/trial", { operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "Read synthetic approved ticket", parameters: { ticketId: approval.record.ticket.id } } }, executedAudit.receipt);
    const lookupAudit = await auditOf(lookup, "completed", executedAudit.receipt);
    assert.equal(lookup.body.execution.ticket.id, approval.record.ticket.id);
    const chain = [trialAudit, previewAudit, submitAudit, approvedAudit, executedAudit, lookupAudit];
    await traceRecords(trialAudit.receipt.traceId, chain.map((record) => record.receipt.id));
    console.log(`PASS approval audit chain: 6 linked requests, ${approval.record.ticket.id}`);

    const marker = `AUDITPORT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const input = {
      title: `Synthetic transport rule ${marker}`, skillId: "search-expense-policy", documentNumber: `SIM-FIN-${marker}`, owner: "Simulation QA",
      effectiveDate: "2026-09-11", dataKind: "policy", filename: "audit-transport.md", simulated: true,
      content: `Simulation only. In the fictional Chengchuan organization, ${marker} transit support is 37 test credits per trip, with a receipt required. Applies only to ${marker}. Internal simulation marker ${forbiddenText}.`,
    };
    const chunkPreview = await api("/api/knowledge/preview", input);
    const chunkAudit = await auditOf(chunkPreview, "completed");
    const created = await api("/api/knowledge", input, chunkAudit.receipt, [201]); document = created.body;
    const draftAudit = await auditOf(created, "draft", chunkAudit.receipt);
    assert.equal(draftAudit.stored.start.input.contentHash, createHash("sha256").update(input.content).digest("hex"));
    const published = await api(`/api/knowledge/${document.entry.id}`, { action: "publish", etag: document.etag }, draftAudit.receipt); document = published.body;
    const publishedAudit = await auditOf(published, "published", draftAudit.receipt);
    let parent = publishedAudit.receipt;
    const documentChain = [chunkAudit.receipt.id, draftAudit.receipt.id, publishedAudit.receipt.id];
    let answer;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      answer = await api("/api/route", { query: `What is the simulated ${marker} transit limit in test credits?`, selectedSkillId: input.skillId }, parent);
      const answerAudit = await auditOf(answer, answer.body.executionStatus, parent);
      documentChain.push(answerAudit.receipt.id); parent = answerAudit.receipt;
      if (answer.body.execution?.type !== "knowledge_not_found") {
        assert.equal(answer.body.execution?.type, "knowledge_answer");
        assert.ok(answerAudit.stored.result.references.some((reference) => reference.type === "source" && reference.id.startsWith(document.entry.id)));
        assert.ok(!JSON.stringify(answerAudit.stored).includes("test credits per trip"), "Audit copied a source quotation");
        break;
      }
    }
    assert.equal(answer.body.execution?.type, "knowledge_answer");
    assert.match(answer.body.execution.answer, /37/);
    const inactive = await api(`/api/knowledge/${document.entry.id}`, { action: "deactivate", etag: document.etag }, parent); document = inactive.body;
    const inactiveAudit = await auditOf(inactive, "inactive", parent); documentChain.push(inactiveAudit.receipt.id);
    await traceRecords(chunkAudit.receipt.traceId, documentChain);
    console.log(`PASS knowledge audit chain: preview/import/publish/citation/deactivate, ${document.entry.id}`);

    const invalid = await api("/api/route", { query: "Invalid synthetic input", parameters: { impact: "invalid" } }, undefined, [400]);
    await auditOf(invalid, "invalid_request");
    await api("/api/plugins/tickets/trial", { operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "No execution for missing parent" } }, { id: `aud-8210900000000-${"f".repeat(32)}` }, [404]);
    console.log("Audit lifecycle passed: durable lineage, selective metadata, invalid request recording and inaccessible-parent rejection");
  } finally {
    if (document && document.entry.status !== "inactive") {
      const latest = (await api(`/api/knowledge/${document.entry.id}`)).body;
      document = (await api(`/api/knowledge/${document.entry.id}`, { action: "deactivate", etag: latest.etag })).body;
      console.log(`Cleanup: ${document.entry.id} inactive`);
    }
    if (approval) {
      const current = (await api(`/api/approvals/${approval.record.id}`)).body;
      if (current.actions.includes("cancel")) { await api(`/api/approvals/${current.record.id}`, { action: "cancel", etag: current.etag, reason: "Incomplete audit acceptance cleanup" }); console.log(`Cleanup: ${current.record.id} withdrawn`); }
      else if (["executing", "execution_unknown"].includes(current.record.status)) { console.error(`Manual receipt reconciliation required: ${current.record.id}`); process.exitCode = 1; }
    }
  }
}