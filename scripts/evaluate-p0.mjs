import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [origin, mode, reportPath, ticketId] = process.argv.slice(2);
const base = new URL(origin);
assert.ok(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
assert.ok(["workflow", "ticket"].includes(mode) && reportPath);
if (mode === "workflow") assert.match(ticketId ?? "", /^ESP-\d{8}-[A-F0-9]{8}$/);
await mkdir(dirname(resolve(reportPath)), { recursive: true });
const handle = await open(resolve(reportPath), "wx");
const report = { schemaVersion: 1, kind: "esp-p0", mode, createdAt: new Date().toISOString(), target: base.origin, requests: [], passed: false, assertions: [], error: null };
async function read(path) {
  const response = await fetch(new URL(path, base), { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(60_000) });
  assert.ok(response.ok, "Read unavailable"); return response.json();
}
async function post(body) {
  const started = performance.now();
  const response = await fetch(new URL("/api/route", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const value = await response.json();
  report.requests.push({ requestId: value.requestId, traceId: value.audit?.traceId, status: response.status, executionStatus: value.executionStatus, error: value.error ?? null, reason: value.workflow?.steps[1]?.verificationReason ?? value.workflow?.steps[1]?.execution?.reason ?? null, durationMs: Math.round(performance.now() - started) });
  return { status: response.status, value };
}
async function audit(receipt, status, requestId, traceId) {
  assert.equal(receipt.status, "recorded");
  const detail = await read(`/api/audit/${receipt.id}`);
  assert.equal(detail.start.requestId, requestId); assert.equal(detail.start.traceId, traceId); assert.equal(detail.result.status, status);
  report.auditsVerified = (report.auditsVerified ?? 0) + 1;
}
try {
  report.releaseBefore = await read("/api/release");
  const state = await read("/api/state"); report.beforeCounts = state.postgres.counts;
  assert.equal(state.writesPaused, false); assert.equal((await read("/api/readiness")).status, "ready");
  if (mode === "workflow") {
    const { value, status } = await post({ query: `先查询工单 ${ticketId}，再根据工单背景查询 IT 处理规范。`, confirmed: false });
    assert.equal(status, 200); assert.equal(value.route.status, "workflow");
    const [ticket, guidance] = value.workflow.steps;
    report.stepStatuses = value.workflow.steps.map((step) => ({ id: step.id, status: step.status, reason: step.verificationReason ?? step.execution?.reason ?? null }));
    for (const entry of [{ audit: value.audit, status: value.executionStatus, requestId: value.requestId }, ...value.workflow.steps]) await audit(entry.audit, entry.status, entry.requestId, value.audit.traceId);
    assert.equal(ticket.execution.ticket.id, ticketId);
    assert.ok(Date.parse(guidance.startedAt) >= Date.parse(ticket.completedAt));
    assert.ok(guidance.query.endsWith(JSON.stringify({ summary: ticket.execution.ticket.summary, device: ticket.execution.ticket.details?.device ?? null })));
    report.assertions.push("owned_ticket", "sequential_execution", "context_binding", "durable_audits");
    assert.equal(guidance.status, "completed", "Guidance did not complete");
    assert.equal(guidance.execution.type, "knowledge_answer");
    assert.ok(guidance.execution.citations.length > 0);
    for (const citation of guidance.execution.citations) {
      assert.equal(citation.url, `/knowledge/${citation.id}`);
      const source = await read(`/api/knowledge/${citation.id}`);
      assert.equal(source.entry.version, citation.version); assert.ok(source.content.includes(citation.excerpt));
      assert.equal(source.entry.knowledgeBase.id, "enterprise");
    }
    report.citationsVerified = guidance.execution.citations.length;
    const answer = guidance.execution.answer;
    for (const expression of [/模拟/, /受理|记录/, /设备|终端/, /客户端|软件/, /升级|转.*组|后续/, /审批|批准|授权/]) assert.match(answer, expression, "Required procedure topic absent");
    assert.doesNotMatch(answer, /(?:已为你|已经为您)(?:修复|关闭|开通|创建)/);
    report.assertions.push("canonical_quotes", "required_topics", "no_claimed_remediation");
    console.log(JSON.stringify({ answer, citations: guidance.execution.citations }, null, 2));
  } else {
    const submissionId = randomUUID();
    const request = { query: "Create one simulated P0 acceptance ticket", selectedSkillId: "create-it-ticket", parameters: { description: "SIM P0 confirmation and idempotency acceptance", impact: "individual", device: "SIM-LT-0042" }, submissionId, confirmed: false };
    const denied = await post({ ...request, confirmed: true });
    assert.equal(denied.status, 409); assert.equal(denied.value.error, "CONFIRMATION_REQUIRED");
    const preview = await post(request); assert.equal(preview.status, 200); assert.equal(preview.value.executionStatus, "waiting_confirmation");
    const confirmation = preview.value.confirmation;
    assert.match(confirmation.id, /^[a-f0-9-]{36}$/); report.confirmationId = confirmation.id; report.ticketId = confirmation.ticketId;
    assert.equal((await post(request)).value.confirmation.id, confirmation.id);
    const altered = await post({ ...request, confirmed: true, confirmationId: confirmation.id, parameters: { ...request.parameters, description: "Different input" } });
    assert.equal(altered.status, 409); assert.equal(altered.value.error, "CONFIRMATION_CONFLICT");
    assert.deepEqual((await read("/api/state")).postgres.counts, report.beforeCounts);
    report.assertions.push("confirmation_required", "immutable_preview", "changed_input_rejected", "no_ticket_before_confirmation");
    const confirmed = { ...request, confirmed: true, confirmationId: confirmation.id };
    const results = await Promise.all([post(confirmed), post(confirmed)]);
    results.push(await post(confirmed));
    for (const result of results) {
      assert.equal(result.status, 200); assert.equal(result.value.executionStatus, "completed");
      assert.equal(result.value.execution.ticket.id, confirmation.ticketId);
      assert.deepEqual(result.value.execution.ticket.details, request.parameters);
      await audit(result.value.audit, "completed", result.value.requestId, result.value.audit.traceId);
    }
    assert.equal(results[2].value.skillUsage[0].receiptReused, true); assert.equal(results[2].value.skillUsage[0].invoked, false);
    report.assertions.push("concurrent_same_receipt", "replay_receipt_reused");
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof assert.AssertionError ? "ACCEPTANCE_ASSERTION_FAILED" : "ACCEPTANCE_UNAVAILABLE";
  console.error(error instanceof assert.AssertionError ? error.message : report.error);
} finally {
  try {
    report.afterCounts = (await read("/api/state")).postgres.counts;
    report.releaseAfter = await read("/api/release"); report.readiness = (await read("/api/readiness")).status;
    report.runtimeStable = report.releaseBefore?.releaseId === report.releaseAfter.releaseId;
    const expectedTickets = report.beforeCounts?.tickets + (mode === "ticket" && report.passed ? 1 : 0);
    report.countsVerified = report.afterCounts.tickets === expectedTickets && report.afterCounts.approvals === report.beforeCounts?.approvals;
    report.passed = report.passed && report.runtimeStable && report.countsVerified && report.readiness === "ready";
  } catch { report.passed = false; report.error ??= "FINAL_STATE_UNAVAILABLE"; }
  await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.close();
}
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;