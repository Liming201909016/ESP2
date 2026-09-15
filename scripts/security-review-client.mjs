import assert from "node:assert/strict";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [origin, action, ...args] = process.argv.slice(2);
const base = new URL(origin);
assert.ok(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
assert.ok(["discover", "start", "get", "approve", "reject", "request_information", "export"].includes(action), "Expected discover/start/get/approve/reject/request_information/export");
let body; let path = "/api/security-reviews"; let file;
if (action === "discover") body = { action, query: args[0] };
else if (action === "start") { assert.ok(args.length === 3, "start <caseId> <submission UUID> <query>"); body = { action, caseId: args[0], submissionId: args[1], query: args[2] }; }
else if (["get", "export"].includes(action)) {
  assert.match(args[0], /^sr-[a-f0-9]{32}$/); path += `?id=${args[0]}`;
  if (action === "export") { assert.ok(args[1]); await mkdir(dirname(resolve(args[1])), { recursive: true }); file = await open(resolve(args[1]), "wx"); }
} else { assert.ok(args.length === 3, "decision <review ID> <etag> <reason>"); body = { action, id: args[0], etag: args[1], reason: args[2] }; }
try {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (file) await file.writeFile(JSON.stringify(result.report ?? { error: result.error }, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
} finally { await file?.close(); }