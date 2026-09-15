import assert from "node:assert/strict";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const [origin, caseId, reportPath] = process.argv.slice(2);
const base = new URL(origin);
assert.ok(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === "/");
assert.match(caseId, /^(?:SIM-(?:QA|KF)-\d{3}|VPN-001)$/); assert.ok(reportPath);
await mkdir(dirname(resolve(reportPath)), { recursive: true });
const report = await open(resolve(reportPath), "wx");
try {
  const release = await (await fetch(new URL("/api/release", base))).json();
  const response = await fetch(new URL("/api/evaluation/diagnostics", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId }), signal: AbortSignal.timeout(120_000) });
  const body = await response.json();
  await report.writeFile(JSON.stringify({ schemaVersion: 1, kind: "esp-simulation-diagnostic", createdAt: new Date().toISOString(), release, status: response.status, ...body }, null, 2));
  console.log(JSON.stringify({ status: response.status, caseId, error: body.diagnostic?.error ?? body.error, candidates: body.diagnostic?.candidates, saved: reportPath }));
  if (!response.ok) process.exitCode = 1;
} finally { await report.close(); }