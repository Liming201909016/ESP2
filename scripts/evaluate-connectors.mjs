import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
const seedExamples = process.argv.includes("--seed");
const lifecycle = process.argv.includes("--lifecycle");
const legacyExamples = JSON.parse(await readFile(new URL("../src/data/connector-examples.json", import.meta.url), "utf8"));
const { connectorExamples } = JSON.parse(await readFile(new URL("../src/data/enterprise-pack.json", import.meta.url), "utf8"));
const examples = [...legacyExamples, ...connectorExamples];

async function api(path, body, parent, expectedStatus = 200) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(parent?.id ? { "x-esp-parent-audit-id": parent.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json().catch(() => null);
  const failure = result?.error ?? result?.sync?.error ?? result?.examples?.filter((example) => example.outcome === "failed").map((example) => `${example.sourceId}:${example.error}`).join(", ");
  assert.equal(response.status, expectedStatus, `${path}: ${failure || response.status} (${result?.audit?.id ?? "no audit ID"})`);
  assert.ok(result, `${path}: missing JSON response`);
  if (path.startsWith("/api/connectors")) assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  return result;
}

function syncRequest(detail) {
  return { action: "sync", manifestEtag: detail.source.manifestEtag, contentEtag: detail.source.contentEtag, fingerprint: detail.source.fingerprint, stateEtag: detail.stateEtag };
}

if (seedExamples) {
  const seeded = await api("/api/connectors", { action: "seed_examples" });
  assert.equal(seeded.executionStatus, "completed"); assert.equal(seeded.examples.length, examples.length);
  assert.equal(seeded.audit?.status, "recorded");
  const repeated = await api("/api/connectors", { action: "seed_examples" });
  assert.ok(repeated.examples.every((example) => example.outcome === "existing"), "Repeated initialization replaced a source");
  console.log(`Example sources ready: ${seeded.examples.filter((example) => example.outcome === "created").length} created, existing sources preserved`);
}

const firstPage = await api("/api/connectors");
assert.equal(firstPage.connector.id, "blob-knowledge");
assert.equal(firstPage.connector.container, "audit");
assert.equal(firstPage.connector.prefix, "connector-sources/knowledge/");
assert.equal(firstPage.connector.mode, "dev-simulation");
assert.ok(firstPage.sources.length <= 20);
console.log(`Blob connector read passed: ${firstPage.sources.length} sources on this bounded page, configured=${firstPage.connector.configured}`);

if (lifecycle) {
  assert.equal(firstPage.canSync, true, "Explicit DEV management identity required");
  const imported = new Map();
  let publishedTestDocument;
  try {
    for (const example of examples) {
      const path = `/api/connectors/blob-knowledge/${example.id}`;
      const detail = await api(path);
      assert.equal(detail.sourceError, null, `${example.id}: ${detail.sourceError}`);
      assert.ok(detail.source, `Missing fixed example: ${example.id}; initialize with --seed first`);
      assert.equal(detail.source.input.content, example.content, "Example source was changed; this evaluator will not modify it");
      assert.equal(detail.source.input.documentNumber, example.documentNumber);
      assert.equal(detail.source.input.skillId, example.skillId);
      assert.equal(detail.source.chunks.map((chunk) => chunk.content).join(""), example.content);
      const request = syncRequest(detail);
      await api(path, { ...request, fingerprint: "0".repeat(64) }, undefined, 409);
      await api(path, { ...request, publish: true }, undefined, 400);
      const result = await api(path, request);
      assert.equal(result.executionStatus, "completed"); assert.equal(result.audit?.status, "recorded");
      assert.ok(["created", "reused"].includes(result.sync.outcome));
      const document = result.detail.document;
      assert.ok(document); assert.equal(document.entry.id, detail.source.documentId);
      assert.equal(document.content, example.content);
      assert.equal(document.provenance.connectorId, "blob-knowledge"); assert.equal(document.provenance.sourceId, example.id);
      assert.equal(document.provenance.fingerprint, detail.source.fingerprint);
      if (result.sync.outcome === "created") {
        assert.equal(document.entry.status, "draft", "Synchronization auto-published a new document");
        const sourceResponse = await fetch(new URL(`/knowledge/${document.chunks[0].id}`, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
        assert.equal(sourceResponse.status, 404, "New draft is available as published evidence");
      } else assert.equal(document.entry.status, detail.document?.entry.status, "Synchronization changed existing publication state");
      const record = await api(`/api/audit/${result.audit.id}`);
      assert.equal(record.start.kind, "connector_sync");
      assert.ok(record.result.references.some((reference) => reference.type === "connector_source" && reference.id === example.id));
      assert.ok(record.result.references.some((reference) => reference.type === "document" && reference.id === document.entry.id));
      assert.ok(!JSON.stringify(record).includes(example.content), "Audit copied source content");
      const current = await api(path);
      const repeated = await api(path, syncRequest(current), result.audit);
      assert.equal(repeated.sync.outcome, "reused"); assert.equal(repeated.sync.documentId, document.entry.id);
      assert.equal(repeated.detail.document.etag, document.etag, "Repeated synchronization rewrote the target document");
      assert.equal(repeated.detail.document.entry.status, document.entry.status);
      await api(path, request, undefined, 409);
      imported.set(example.id, { created: result.sync.outcome === "created", document, audit: repeated.audit, source: detail.source });
      console.log(`PASS ${example.id}: ${result.sync.outcome}, repeat reused ${document.entry.id}, source provenance retained`);
    }

    const finance = imported.get("sim-fin-harbor");
    const financePath = "/api/connectors/blob-knowledge/sim-fin-harbor";
    const concurrentInput = syncRequest(await api(financePath));
    const concurrent = await Promise.all([1, 2].map(async () => {
      const response = await fetch(new URL(financePath, baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(concurrentInput), signal: AbortSignal.timeout(65_000) });
      const body = await response.json(); return { status: response.status, body };
    }));
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    assert.equal(concurrent.find((result) => result.status === 200).body.sync.documentId, finance.document.entry.id);
    console.log("PASS concurrent sync: one accepted operation, same target document");

    if (finance.created) {
      publishedTestDocument = finance.document.entry.id;
      const published = await api(`/api/knowledge/${publishedTestDocument}`, { action: "publish", etag: finance.document.etag }, finance.audit);
      assert.equal(published.entry.status, "published");
      const unchanged = await api(financePath);
      const reused = await api(financePath, syncRequest(unchanged), published.audit);
      assert.equal(reused.sync.outcome, "reused"); assert.equal(reused.detail.document.entry.status, "published");
      assert.equal(reused.detail.document.etag, published.etag);
      const query = "SIM-FIN-BLOB-001 云港测试园区接驳交通补贴每天多少元，需要哪些凭证？";
      let answer;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        answer = await api("/api/route", { query, selectedSkillId: "search-expense-policy", confirmed: false }, reused.audit);
        if (answer.execution?.type !== "knowledge_not_found" || attempt === 3) break;
        console.log(`Index visibility ${attempt}/3: no evidence yet`);
      }
      assert.equal(answer.execution?.type, "knowledge_answer"); assert.equal(answer.execution.corpus, "dev-library");
      assert.match(answer.execution.answer, /43/);
      const citation = answer.execution.citations.find((entry) => entry.id.startsWith(`${publishedTestDocument}-c`));
      assert.ok(citation && finance.document.content.includes(citation.excerpt), "Answer is missing an exact synced-source quote");
      const sourcePage = await fetch(new URL(citation.url, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      assert.equal(sourcePage.status, 200);
      const inactive = await api(`/api/knowledge/${publishedTestDocument}`, { action: "deactivate", etag: published.etag }, answer.audit);
      assert.equal(inactive.entry.status, "inactive");
      const latest = await api(financePath);
      const inactiveReuse = await api(financePath, syncRequest(latest), inactive.audit);
      assert.equal(inactiveReuse.sync.outcome, "reused"); assert.equal(inactiveReuse.detail.document.entry.status, "inactive");
      const withdrawnPage = await fetch(new URL(citation.url, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      assert.equal(withdrawnPage.status, 404);
      console.log(`PASS sync/publish/citation/withdrawal: ${publishedTestDocument}, finance test document inactive`);
    } else console.log("Publication lifecycle skipped: finance target pre-existed; its publication state was preserved");

    console.log("Blob connector acceptance passed: fixed source reads, exact drafts, version conflicts, idempotent sync and audit references");
  } finally {
    if (publishedTestDocument) {
      const latest = await api(`/api/knowledge/${publishedTestDocument}`);
      if (latest.entry.status !== "inactive") {
        const inactive = await api(`/api/knowledge/${publishedTestDocument}`, { action: "deactivate", etag: latest.etag });
        assert.equal(inactive.entry.status, "inactive");
        console.log(`Test cleanup: ${publishedTestDocument} deactivated`);
      }
    }
  }
}