import assert from "node:assert/strict";

const baseUrl = new URL(process.argv[2] ?? "http://localhost:3000");
const devBypass = process.argv.includes("--dev-bypass");
const ticketLifecycle = process.argv.includes("--ticket-lifecycle");
assert.ok(!ticketLifecycle || devBypass, "--ticket-lifecycle requires --dev-bypass");

async function request(path, init) {
  return fetch(new URL(path, baseUrl), {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
}

async function routeQuery(query, confirmed = false, options = {}) {
  const response = await request("/api/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, confirmed, ...options }),
  });
  assert.equal(response.status, 200, `route returned ${response.status}`);
  return response.json();
}

const health = await request("/api/health");
assert.equal(health.status, 200, `health returned ${health.status}`);
const healthBody = await health.json();
assert.equal(healthBody.status, "healthy");
assert.equal(healthBody.ready, true);

const route = await request("/api/route", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "company leave policy" }),
});
if (devBypass) {
  assert.equal(route.status, 200, `DEV route returned ${route.status}`);
  const routeBody = await route.json();
  assert.equal(routeBody.identity?.source, "development");
  assert.equal(routeBody.route?.status, "matched");
  assert.notEqual(routeBody.executionStatus, "ready", "matched skills must return a concrete outcome");

  const missingId = await routeQuery("ticket status");
  assert.equal(missingId.executionStatus, "needs_input");
  assert.equal(missingId.execution?.field, "ticketId");

  const unknownTicket = await routeQuery("ticket status ESP-19700101-00000000");
  assert.equal(unknownTicket.executionStatus, "not_found");

  const incompleteTicket = await routeQuery("create ticket", true, { parameters: {} });
  assert.equal(incompleteTicket.executionStatus, "needs_input");
  assert.deepEqual(incompleteTicket.execution?.missingFields, ["description", "impact"]);

  if (ticketLifecycle) {
    const query = `create ticket for DEV smoke ${new Date().toISOString()}`;
    const parameters = { description: query, device: "SIM-LT-SMOKE", impact: "individual" };
    const options = { selectedSkillId: "create-it-ticket", parameters };
    const preview = await routeQuery(query, false, options);
    assert.equal(preview.executionStatus, "waiting_confirmation");
    assert.equal(preview.execution, null);

    const created = await routeQuery(query, true, options);
    assert.equal(created.executionStatus, "completed");
    assert.equal(created.execution?.type, "ticket_created");
    const ticket = created.execution.ticket;
    assert.deepEqual(ticket.details, parameters);

    const lookup = await routeQuery(`ticket status ${ticket.id}`);
    assert.equal(lookup.executionStatus, "completed");
    assert.equal(lookup.execution?.type, "ticket_status");
    assert.deepEqual(lookup.execution.ticket, ticket);

    const records = await request("/api/tickets");
    assert.equal(records.status, 200);
    const ledger = await records.json();
    assert.ok(ledger.tickets.some((record) => record.id === ticket.id), "created ticket missing from records");
    console.log(`Ticket lifecycle passed: ${ticket.id}`);
  }
} else {
  assert.equal(route.status, 401, `anonymous route returned ${route.status}`);

  const login = await request("/.auth/login/aad?post_login_redirect_uri=%2F");
  assert.equal(login.status, 302, `login returned ${login.status}`);
  assert.match(login.headers.get("location") ?? "", /^https:\/\/login\.microsoftonline\.com\//);
}

console.log(`Smoke checks passed for ${baseUrl.origin}`);