import assert from "node:assert/strict";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
assert.ok(["http:", "https:"].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash && baseUrl.pathname === "/", "Expected an HTTP origin without credentials or query parameters");

async function api(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(40_000),
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  const result = await response.json();
  if (path === "/api/readiness") assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  return result;
}

const health = await api("/api/health");
assert.equal(health.status, "healthy"); assert.equal(health.ready, true);
console.log(`PASS liveness: ${health.state.backend}, writesPaused=${health.state.writesPaused}`);

const [first, second] = await Promise.all([api("/api/readiness"), api("/api/readiness")]);
assert.deepEqual(first, second, "Concurrent readiness callers did not share the same cached probe result");
assert.deepEqual(Object.keys(first).sort(), ["checks", "checkedAt", "model", "scope", "status", "validUntil"].sort());
assert.equal(first.status, "ready"); assert.equal(first.scope, "storage-search-state"); assert.equal(first.model, "not_probed");
assert.equal(Date.parse(first.validUntil) - Date.parse(first.checkedAt), 60_000);
assert.deepEqual(Object.keys(first.checks).sort(), ["blob", "search", "state"]);
for (const [name, result] of Object.entries(first.checks)) {
  assert.deepEqual(Object.keys(result).sort(), ["durationMs", "status"]);
  assert.equal(result.status, name === "state" && health.state.backend !== "postgres" ? "not_required" : "healthy");
  assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0);
  console.log(`PASS readiness ${name}: ${result.status}, ${result.durationMs}ms`);
}

const trial = await api("/api/plugins/tickets/trial", {
  operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "Monitoring acceptance: ticket status without an identifier" },
});
assert.equal(trial.status, "needs_input"); assert.equal(trial.mode, "live_read"); assert.equal(trial.execution.type, "input_required");
assert.equal(trial.audit?.status, "recorded"); assert.match(trial.requestId, /^[a-f0-9-]{36}$/);
console.log(`PASS safe operational event: requestId=${trial.requestId}, audit=${trial.audit.status}`);
console.log("Monitoring runtime acceptance passed; no model calls or business writes (audit metadata only)");