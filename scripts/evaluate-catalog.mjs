import assert from "node:assert/strict";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const runTrials = process.argv.includes("--trials");

const response = await fetch(new URL("/api/skills", baseUrl), {
  redirect: "manual", signal: AbortSignal.timeout(15_000),
});
assert.equal(response.status, 200, `Catalog HTTP ${response.status}`);
assert.match(response.headers.get("cache-control") ?? "", /no-store/);
const catalog = await response.json();
assert.ok(Array.isArray(catalog.skills) && catalog.skills.length > 0, "No visible skills");
assert.ok(!Number.isNaN(Date.parse(catalog.generatedAt)), "Missing catalog timestamp");
assert.equal(new Set(catalog.skills.map((skill) => skill.id)).size, catalog.skills.length, "Duplicate skills");

async function trial(skill, parameters) {
  const example = skill.examples[0];
  assert.ok(example?.query, `Missing trial for ${skill.id}`);
  const response = await fetch(new URL("/api/route", baseUrl), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: example.query, selectedSkillId: skill.id, confirmed: false, ...(parameters === undefined ? {} : { parameters }) }),
    redirect: "manual", signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${skill.id}: ${result.error ?? response.status}`);
  assert.equal(result.route?.skill?.id, skill.id, "Trial changed the selected skill");
  assert.equal(result.intent?.source, "selection");
  assert.notEqual(result.execution?.type, "ticket_created", "Catalog trial must never create a ticket");
  return result;
}

for (const skill of catalog.skills) {
  assert.match(skill.version, /^\d+\.\d+\.\d+$/);
  assert.ok(skill.permissions.length > 0);
  assert.ok(Array.isArray(skill.inputs) && Array.isArray(skill.sources) && Array.isArray(skill.examples));
  assert.ok(skill.inputs.every((input) => skill.inputSchema.required?.includes(input.name) === input.required || (!input.required && !skill.inputSchema.required)));
  for (const source of skill.sources) {
    assert.match(source.url, /^\/knowledge\/dev-[a-z0-9-]+$/);
    assert.ok(source.documentNumber && source.version && source.effectiveDate);
  }

  if (skill.implementation === "ticket_create") {
    assert.equal(skill.confirmationRequired, true);
    assert.deepEqual(skill.inputs.filter((input) => input.required).map((input) => input.name), ["description", "impact"]);
  }

  if (runTrials && skill.implementation !== "unavailable") {
    const result = await trial(skill, skill.implementation === "ticket_create" ? {} : undefined);
    if (skill.implementation === "knowledge") {
      assert.equal(result.executionStatus, "completed");
      assert.equal(result.execution?.type, "knowledge_answer");
      assert.ok(result.execution.citations.length > 0);
      assert.ok(result.execution.citations.every((citation) => skill.sources.some((source) => source.id === citation.id)));
    } else if (skill.implementation === "ticket_lookup") {
      assert.equal(result.executionStatus, "needs_input");
      assert.equal(result.execution?.field, "ticketId");
    } else if (skill.implementation === "ticket_create") {
      assert.equal(result.executionStatus, "needs_input");
      assert.equal(result.execution?.type, "ticket_details_required");
      const preview = await trial(skill, { description: "Catalog preview only, no ticket write", impact: "individual" });
      assert.equal(preview.executionStatus, "waiting_confirmation");
      assert.equal(preview.execution, null);
    }
  }
  console.log(`PASS ${skill.id}: ${skill.implementation}${runTrials ? " (unconfirmed trial)" : ""}`);
}

console.log(`Catalog checks passed: ${catalog.skills.length} visible skills, no writes`);