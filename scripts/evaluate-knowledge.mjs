import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { KnowledgeEvaluationError, knowledgeChallengeCases, knowledgeChallengeVersion, knowledgeFailureCode, knowledgeHttpFailureCode, parseKnowledgeEvaluationArgs, summarizeKnowledgeEvaluation, validateKnowledgeResult } from "./knowledge-evaluation-rules.mjs";
import { evaluationRuntimeSchema } from "../src/lib/esp/skill-evaluation-contracts.ts";

const { baseUrl, selectedId, reportPath, caseSet } = parseKnowledgeEvaluationArgs(process.argv.slice(2));
const allCases = caseSet === "challenge" ? knowledgeChallengeCases : JSON.parse(await readFile(new URL("../src/data/simulation-cases.json", import.meta.url), "utf8"));
const cases = selectedId ? allCases.filter((testCase) => testCase.id === selectedId) : allCases;
if (!cases.length) throw new KnowledgeEvaluationError("UNKNOWN_CASE");
const { documents, version } = JSON.parse(await readFile(new URL("../src/data/enterprise-pack.json", import.meta.url), "utf8"));
let reportHandle;
if (reportPath) {
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  reportHandle = await open(resolve(reportPath), "wx");
}

async function captureRuntime() {
  if (!reportPath) return null;
  try {
    const response = await fetch(new URL("/api/skills", baseUrl), { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const parsed = evaluationRuntimeSchema.safeParse((await response.json())?.evaluationRuntime);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const evaluatorFiles = [
  new URL(import.meta.url), new URL("./knowledge-evaluation-rules.mjs", import.meta.url),
  new URL("../src/lib/esp/skill-evaluation-contracts.ts", import.meta.url),
  new URL("../src/lib/esp/contracts.ts", import.meta.url),
];
const evaluatorDigest = createHash("sha256").update(JSON.stringify(await Promise.all(evaluatorFiles.map((url) => readFile(url, "utf8"))))).digest("hex");
const caseSetDigest = createHash("sha256").update(JSON.stringify(cases)).digest("hex");
const runtimeBefore = await captureRuntime();
const startedAt = new Date().toISOString();
const started = performance.now();

const checkedSources = new Set();
const results = [];
for (const testCase of cases) {
  const caseStarted = performance.now();
  const item = { caseId: testCase.id, category: testCase.category, skillId: testCase.skillId, expected: testCase.expected, passed: false, httpStatus: null, executionStatus: null, requestId: null, durationMs: 0, failureCode: null, sources: [] };
  try {
    const response = await fetch(new URL("/api/route", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: testCase.query, ...(caseSet === "challenge" ? { selectedSkillId: testCase.skillId, confirmed: false } : {}) }),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => null);
    item.httpStatus = response.status;
    item.requestId = typeof result?.requestId === "string" && /^[a-f0-9-]{36}$/.test(result.requestId) ? result.requestId : null;
    item.executionStatus = ["completed", "no_evidence", "failed", "unavailable", "needs_input", "not_routed"].includes(result?.executionStatus) ? result.executionStatus : null;
    if (response.status !== 200) throw new KnowledgeEvaluationError(knowledgeHttpFailureCode(response.status, result));
    const citations = validateKnowledgeResult(testCase, result, documents);
    for (const citation of citations) {
      if (!checkedSources.has(citation.url)) {
        const source = await fetch(new URL(citation.url, baseUrl), { signal: AbortSignal.timeout(15_000), redirect: "manual" });
        if (source.status !== 200) throw new KnowledgeEvaluationError("SOURCE_PAGE_UNAVAILABLE");
        if (!(await source.text()).includes(citation.id)) throw new KnowledgeEvaluationError("SOURCE_PAGE_MISMATCH");
        checkedSources.add(citation.url);
      }
    }
    item.sources = [...new Map(citations.map((citation) => [citation.id, { id: citation.id, version: citation.version }])).values()];
    item.passed = true;
    console.log(`PASS ${testCase.id}: ${result.executionStatus}`);
  } catch (error) {
    item.failureCode = knowledgeFailureCode(error);
    console.error(`FAIL ${testCase.id}: ${item.failureCode}${item.requestId ? ` (${item.requestId})` : ""}`);
  } finally {
    item.durationMs = Math.round(performance.now() - caseStarted);
    results.push(item);
  }
}
const runtimeAfter = await captureRuntime();
const summary = summarizeKnowledgeEvaluation(results);
const report = {
  schemaVersion: 1, suite: "esp-knowledge", runId: randomUUID(), targetOrigin: baseUrl.origin, dataVersion: version,
  caseSet, caseSetVersion: caseSet === "challenge" ? knowledgeChallengeVersion : version,
  provenance: { contractVersion: "1.0.0", evaluatorDigest, caseSetDigest, scope: caseSet === "challenge" ? "answer_only" : "routing_and_answer", runtimeBefore, runtimeAfter },
  startedAt, completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
  selection: selectedId ?? "all", summary, results,
};
if (reportPath) {
  const destination = resolve(reportPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(reportHandle, `${JSON.stringify(report, null, 2)}\n`);
  await reportHandle.close();
  console.log(`Metadata-only report: ${destination}`);
}
console.log(`Knowledge evaluation: ${summary.passed}/${summary.total} passed`);
if (summary.failed) process.exitCode = 1;