import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const writeLifecycle = process.argv.includes("--write-lifecycle");

async function api(path, body, expectedStatus = 200) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, `${path}: ${result.error ?? result.entry?.lastError ?? "unexpected response"}`);
  return result;
}

const list = await api("/api/knowledge");
assert.equal(list.builtins.length, 100);
assert.ok(Array.isArray(list.documents));
const source = await api(`/api/knowledge/${list.builtins[0].id}`);
assert.equal(source.canManage, false);
assert.ok(source.chunks.length);
console.log(`Library read passed: 100 builtins, ${list.documents.length} imported records on first page`);

if (writeLifecycle) {
  assert.equal(list.canManage, true, "Write lifecycle requires explicit DEV management mode");
  const marker = `TESTPORT-${randomUUID().slice(0, 8).toUpperCase()}`;
  const input = {
    title: `Simulated transit policy ${marker}`,
    skillId: "search-expense-policy", documentNumber: `SIM-FIN-${marker}`, owner: "Simulation QA",
    effectiveDate: "2026-09-10", dataKind: "policy", filename: "test-transit.md", simulated: true,
    content: `# Simulation only\n\nIn the fictional Chengchuan organization, ${marker} transit reimbursement has an upper limit of 37 test credits per trip. A receipt is required. This is not a real corporate rule and applies only to ${marker}.`,
  };
  let current;
  try {
    const preview = await api("/api/knowledge/preview", input);
    assert.equal(preview.chunks.map((chunk) => chunk.content).join(""), preview.content);
    current = await api("/api/knowledge", input, 201);
    assert.equal(current.entry.status, "draft");
    const firstChunk = current.chunks[0];
    const unpublished = await fetch(new URL(`/knowledge/${firstChunk.id}`, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    assert.equal(unpublished.status, 404, "Draft sources must not be accessible as citations");
    const draftEtag = current.etag;
    current = await api(`/api/knowledge/${current.entry.id}`, { action: "publish", etag: current.etag });
    assert.equal(current.entry.status, "published");
    await api(`/api/knowledge/${current.entry.id}`, { action: "deactivate", etag: draftEtag }, 409);
    const publishedSource = await fetch(new URL(`/knowledge/${firstChunk.id}`, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    assert.equal(publishedSource.status, 200);
    assert.ok((await publishedSource.text()).includes(marker));
    const persisted = await api(`/api/knowledge/${current.entry.id}`);
    assert.equal(persisted.entry.status, "published", "Published state was not persisted");
    assert.equal(persisted.etag, current.etag, "Published record ETag does not match");

    const query = `For the simulated expense policy specific to ${marker}, what is the transit limit in test credits?`;
    let answer;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      answer = await api("/api/route", { query, selectedSkillId: input.skillId });
      if (answer.execution?.type !== "knowledge_not_found" || attempt === 3) break;
      console.log(`Publication query ${attempt}/3 returned no evidence; checking again for index visibility`);
    }
    assert.equal(answer.execution?.type, "knowledge_answer", `Published document was not answerable after bounded visibility checks (${answer.requestId ?? "no request ID"})`);
    assert.equal(answer.execution.corpus, "dev-library");
    assert.match(answer.execution.answer, /37/);
    assert.ok(answer.execution.citations.some((citation) => citation.id === firstChunk.id && input.content.includes(citation.excerpt)));
    current = await api(`/api/knowledge/${current.entry.id}`, { action: "deactivate", etag: current.etag });
    assert.equal(current.entry.status, "inactive");
    const withdrawn = await fetch(new URL(`/knowledge/${firstChunk.id}`, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    assert.equal(withdrawn.status, 404, "Inactive source still publicly readable");
    const after = await api("/api/route", { query, selectedSkillId: input.skillId });
    assert.ok(!after.execution?.citations?.some((citation) => citation.id === firstChunk.id), "Inactive source still cited");
    console.log(`Library lifecycle passed: ${current.entry.id}, published citation verified, test document deactivated`);
  } finally {
    if (current && current.entry.status !== "inactive") {
      const latest = await api(`/api/knowledge/${current.entry.id}`);
      const inactive = await api(`/api/knowledge/${current.entry.id}`, { action: "deactivate", etag: latest.etag });
      assert.equal(inactive.entry.status, "inactive");
      console.log(`Test cleanup: ${current.entry.id} deactivated; original retained`);
    }
  }
}