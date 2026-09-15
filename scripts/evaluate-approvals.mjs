import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const lifecycle = process.argv.includes("--lifecycle");

async function api(path, body, statuses = [200]) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json().catch(() => null);
  assert.ok(statuses.includes(response.status), `${path}: HTTP ${response.status}, ${result?.error ?? result?.record?.failureCode ?? "unexpected response"}`);
  assert.ok(result, `${path}: missing JSON`);
  if (path.startsWith("/api/approvals") || path === "/api/policies") assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  return { status: response.status, body: result };
}

const policy = (await api("/api/policies")).body;
assert.equal(policy.policies.length, 1);
assert.equal(policy.policies[0].id, "dev-ticket-impact-review");
assert.deepEqual(policy.policies[0].rules.map(({ impact, effect }) => [impact, effect]), [["individual", "confirmation"], ["team", "approval"], ["organization", "approval"]]);
const queue = (await api("/api/approvals")).body;
assert.ok(Array.isArray(queue.approvals));
assert.ok(queue.approvals.length <= 20);
console.log(`Policy and queue reads passed: 3 impact rules, ${queue.approvals.length} records on this page`);

if (lifecycle) {
  assert.equal(policy.canReview, true, "Explicit DEV reviewer mode required");
  const ownedApprovals = new Set();
  async function submit(impact, suffix) {
    const marker = `APPROVAL-TEST-${suffix}-${randomUUID()}`;
    const request = { query: `Create a simulated outage ticket ${marker}`, selectedSkillId: "create-it-ticket", parameters: { description: `Synthetic outage ${marker}`, impact }, submissionId: randomUUID() };
    const preview = (await api("/api/route", { ...request, confirmed: false })).body;
    assert.equal(preview.executionStatus, "waiting_confirmation"); assert.equal(preview.policy.effect, "approval"); assert.equal(preview.approval, null);
    const first = (await api("/api/route", { ...request, confirmed: true })).body;
    assert.equal(first.executionStatus, "waiting_approval"); assert.equal(first.execution, null);
    assert.equal(first.approval.record.status, "pending");
    ownedApprovals.add(first.approval.record.id);
    const second = (await api("/api/route", { ...request, confirmed: true })).body;
    assert.equal(second.approval.record.id, first.approval.record.id, "Repeated submission created another approval");
    await api("/api/route", { ...request, confirmed: true, parameters: { ...request.parameters, description: "Changed after submission" } }, [409]);
    return first.approval;
  }
  async function action(stored, actionName, reason, statuses = [200]) {
    return (await api(`/api/approvals/${stored.record.id}`, { action: actionName, etag: stored.etag, ...(reason ? { reason } : {}) }, statuses)).body;
  }
  try {
    const pending = await submit("team", "approve");
    await action(pending, "execute", undefined, [409]);
    await api(`/api/approvals/${pending.record.id}`, { action: "approve", etag: pending.etag, parameters: { impact: "individual" } }, [400]);
    const approved = await action(pending, "approve", "Reviewed this synthetic DEV request");
    assert.equal(approved.record.status, "approved"); assert.equal(approved.record.ticket, undefined);
    await action(pending, "reject", "Stale review must fail", [409]);
    const executions = await Promise.all([1, 2].map(() => api(`/api/approvals/${approved.record.id}`, { action: "execute", etag: approved.etag }, [200, 409])));
    assert.ok(executions.some((result) => result.status === 200 && result.body.record.status === "completed"));
    const completed = (await api(`/api/approvals/${approved.record.id}`)).body;
    assert.equal(completed.record.status, "completed"); assert.equal(completed.record.execution.attempts, 1);
    assert.deepEqual(completed.record.ticket.details, pending.record.parameters);
    assert.equal(completed.record.ticket.approvalId, completed.record.id);
    const repeated = await action(approved, "execute");
    assert.deepEqual(repeated.record.ticket, completed.record.ticket);
    assert.equal(repeated.record.events.length, completed.record.events.length);
    const lookup = (await api("/api/plugins/tickets/trial", { operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "Read approved synthetic ticket", parameters: { ticketId: completed.record.ticket.id } } })).body;
    assert.equal(lookup.status, "completed"); assert.deepEqual(lookup.execution.ticket, completed.record.ticket);
    console.log(`PASS approved execution: ${completed.record.id} -> ${completed.record.ticket.id}, concurrent/repeat calls did not create another ticket`);

    const rejectPending = await submit("organization", "reject");
    await action(rejectPending, "reject", undefined, [400]);
    const rejected = await action(rejectPending, "reject", "Synthetic scope rejected for acceptance testing");
    assert.equal(rejected.record.status, "rejected");
    await action(rejected, "execute", undefined, [409]); await action(rejected, "approve", undefined, [409]);
    assert.equal(rejected.record.ticket, undefined);
    console.log(`PASS rejected approval: ${rejected.record.id}, execution denied`);

    const cancelApproved = await action(await submit("team", "cancel"), "approve", "Synthetic review before withdrawal");
    const cancelled = await action(cancelApproved, "cancel", "Synthetic request withdrawn");
    assert.equal(cancelled.record.status, "cancelled"); await action(cancelled, "execute", undefined, [409]);
    assert.equal(cancelled.record.ticket, undefined);
    console.log(`PASS approved withdrawal: ${cancelled.record.id}, execution denied`);
    console.log("Approval lifecycle passed: immutable input, ETag decisions, guarded execution, owned receipt, rejection and withdrawal");
  } finally {
    for (const id of ownedApprovals) {
      const stored = (await api(`/api/approvals/${id}`)).body;
      if (["pending", "approved"].includes(stored.record.status)) {
        await action(stored, "cancel", "Incomplete acceptance run cleanup");
        console.log(`Cleanup: ${id} withdrawn`);
      } else if (["executing", "execution_unknown"].includes(stored.record.status)) {
        console.error(`Approval ${id} requires receipt reconciliation; no automatic re-execution attempted`);
        process.exitCode = 1;
      }
    }
  }
}