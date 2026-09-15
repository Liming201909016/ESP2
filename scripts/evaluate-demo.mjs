import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkDemoResult, demoBlockers, demoCases, demoRequest, demoVersion, loadDemoPreflight } from "../src/lib/esp/demo.ts";

export async function evaluateDemo(baseUrl, options = {}, request = (url, init) => fetch(url, init)) {
  const target = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && target.pathname === "/" && !target.search && !target.hash, "Expected an origin without credentials or path");
  const cases = options.caseId ? demoCases.filter((entry) => entry.id === options.caseId) : [...demoCases];
  assert.ok(cases.length, "Unknown demo case");
  async function read(path) {
    const response = await request(new URL(path, target), { redirect: "manual", signal: AbortSignal.timeout(35_000), headers: { "cache-control": "no-cache" } });
    if (!response.ok) throw new Error("DEMO_READ_FAILED");
    return response.json();
  }
  const before = await loadDemoPreflight(read);
  const report = {
    schemaVersion: 1, kind: "esp-demo", caseSetVersion: demoVersion, createdAt: new Date().toISOString(),
    target: target.origin, mode: options.run ? "live_read" : "preflight_only", releaseBefore: before.release,
    checks: { errors: before.errors, dependenciesReady: before.readiness?.status === "ready", model: "not_probed", releaseRegistered: !!before.release },
    cases: cases.map((selected) => ({ id: selected.id, status: "pending", blockers: [], requestId: null, durationMs: null, httpStatus: null, executionStatus: null, taskOutcomes: [], error: null, citationsVerified: 0, auditsVerified: 0 })), beforeCounts: before.state?.postgres?.counts ?? null,
    afterCounts: null, releaseAfter: null, runtimeStable: false, businessCountsUnchanged: null, passed: false,
  };
  for (const selected of cases) {
    const preflight = options.run ? await loadDemoPreflight(read) : before;
    const blockers = demoBlockers(selected, preflight, options.ticketId);
    const entry = report.cases.find((entry) => entry.id === selected.id);
    entry.status = blockers.length ? "blocked" : "ready"; entry.blockers = blockers;
    if (!options.run || blockers.length) continue;
    const started = performance.now();
    try {
      const response = await request(new URL("/api/route", target), {
        method: "POST", headers: { "content-type": "application/json" }, redirect: "manual",
        body: JSON.stringify(demoRequest(selected.id, selected.requiresTicket ? options.ticketId : undefined)), signal: AbortSignal.timeout(120_000),
      });
      entry.httpStatus = response.status;
      const body = await response.json();
      entry.requestId = typeof body.requestId === "string" && /^[a-f0-9-]{36}$/i.test(body.requestId) ? body.requestId : null;
      const statuses = ["completed", "partial", "failed", "no_result", "no_evidence", "needs_input", "not_found", "not_routed"];
      entry.executionStatus = statuses.includes(body.executionStatus) ? body.executionStatus : null;
      entry.taskOutcomes = Array.isArray(body.parallel?.tasks) ? body.parallel.tasks.slice(0, 3).flatMap((task) => selected.skills.includes(task.usage?.skillId) ? [{ skillId: task.usage.skillId, status: statuses.includes(task.executionStatus) ? task.executionStatus : "unconfirmed" }] : []) : [];
      if (!response.ok) throw new Error("DEMO_HTTP_FAILED");
      const outcome = checkDemoResult(selected, body, options.ticketId);
      entry.requestId = outcome.requestId; entry.executionStatus = outcome.status;
      const tasks = body.parallel?.tasks ?? [];
      for (const execution of [body.execution, ...tasks.map((task) => task.execution)]) {
        for (const citation of execution?.citations ?? []) {
          assert.ok(/^(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32}-c\d{3})$/.test(citation.id), "DEMO_CITATION_MISMATCH");
          assert.equal(citation.url, `/knowledge/${citation.id}`, "DEMO_CITATION_MISMATCH");
          const source = await read(`/api/knowledge/${citation.id}`);
          assert.ok(typeof source.content === "string" && source.content.includes(citation.excerpt), "DEMO_CITATION_MISMATCH");
          if (execution.knowledgeBase) assert.equal(source.entry?.knowledgeBase?.id, execution.knowledgeBase.id, "DEMO_CITATION_MISMATCH");
          entry.citationsVerified += 1;
        }
      }
      const auditEntries = [{ receipt: body.audit, status: body.executionStatus, requestId: body.requestId }, ...tasks.map((task) => ({ receipt: task.audit, status: task.executionStatus, requestId: task.requestId }))];
      assert.equal(new Set(auditEntries.map((entry) => entry.requestId)).size, auditEntries.length, "DEMO_AUDIT_MISMATCH");
      for (const audit of auditEntries) {
        assert.ok(audit.receipt?.status === "recorded" && /^aud-\d{13}-[a-f0-9]{32}$/.test(audit.receipt.id), "DEMO_AUDIT_MISMATCH");
        const detail = await read(`/api/audit/${audit.receipt.id}`);
        assert.ok(detail.start?.requestId === audit.requestId && detail.start?.traceId === body.audit.traceId && detail.start?.mutation === false && detail.result?.status === audit.status, "DEMO_AUDIT_MISMATCH");
        entry.auditsVerified += 1;
      }
      entry.status = "passed";
    } catch (error) {
      entry.status = "failed";
      const allowed = ["DEMO_READ_FAILED", "DEMO_HTTP_FAILED", "DEMO_SKILL_MISMATCH", "DEMO_INVOCATION_MISMATCH", "DEMO_PLUGIN_MISMATCH", "DEMO_KNOWLEDGE_BASE_MISMATCH", "DEMO_CLARIFICATION_MISMATCH", "DEMO_REFUSAL_MISMATCH", "DEMO_PARALLEL_INCOMPLETE", "DEMO_TASK_MISMATCH", "DEMO_TICKET_MISMATCH", "DEMO_EVIDENCE_MISMATCH", "DEMO_CITATION_MISMATCH", "DEMO_AUDIT_MISMATCH"];
      entry.error = allowed.find((code) => error instanceof Error && error.message.startsWith(code)) ?? "DEMO_UNCONFIRMED";
    } finally { entry.durationMs = Math.round(performance.now() - started); }
  }
  const after = options.run ? await loadDemoPreflight(read) : before;
  report.releaseAfter = after.release;
  report.afterCounts = after.state?.postgres?.counts ?? null;
  const runtimeSnapshot = (preflight) => ({ release: preflight.release, skills: preflight.skills.map((skill) => ({ id: skill.id, knowledgeBase: skill.knowledgeBase, sources: skill.sources })), plugins: preflight.plugins, backend: preflight.state?.backend, writesPaused: preflight.state?.writesPaused });
  report.runtimeStable = !!before.release && !!after.release && JSON.stringify(runtimeSnapshot(before)) === JSON.stringify(runtimeSnapshot(after));
  report.businessCountsUnchanged = report.beforeCounts && report.afterCounts ? JSON.stringify(report.beforeCounts) === JSON.stringify(report.afterCounts) : null;
  report.passed = report.cases.every((entry) => entry.status === (options.run ? "passed" : "ready")) && (!options.run || report.runtimeStable && report.businessCountsUnchanged === true && after.readiness?.status === "ready");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node scripts/evaluate-demo.mjs <origin> [--run] [--case DEMO-001] [--ticket-id ESP-...] [--report <new-file>]\nDefault: dependency/configuration reads only. --run invokes real read skills and writes normal audit metadata, never creates tickets or approvals. Reports contain no answers or quotations.");
  } else {
    const [origin, ...flags] = args;
    assert.ok(origin, "An explicit target origin is required");
    const options = {};
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index];
      if (flag === "--run") { assert.ok(!options.run, "Duplicate run flag"); options.run = true; }
      else {
        const key = { "--case": "caseId", "--ticket-id": "ticketId", "--report": "reportPath" }[flag];
        assert.ok(key && !options[key] && flags[index + 1] && !flags[index + 1].startsWith("--"), "Unknown, duplicate or missing option");
        options[key] = flags[++index];
      }
    }
    let handle;
    if (options.reportPath) { await mkdir(dirname(resolve(options.reportPath)), { recursive: true }); handle = await (await import("node:fs/promises")).open(resolve(options.reportPath), "wx"); }
    try {
      const report = await evaluateDemo(origin, options);
      if (handle) await writeFile(handle, `${JSON.stringify(report, null, 2)}\n`);
      for (const entry of report.cases) console.log(`${entry.status.toUpperCase()} ${entry.id}${entry.error ? ` ${entry.error}` : ""}`);
      console.log(JSON.stringify({ passed: report.passed, mode: report.mode, runtimeStable: report.runtimeStable, businessCountsUnchanged: report.businessCountsUnchanged }));
      if (!report.passed) process.exitCode = 1;
    } finally { await handle?.close(); }
  }
}