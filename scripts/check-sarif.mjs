import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

function sarifFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sarifFiles(path) : extname(entry.name) === ".sarif" ? [path] : [];
  });
}

const directory = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2] && existsSync(directory), "Expected a SARIF results directory");

const files = sarifFiles(directory);
assert.ok(files.length > 0, "No SARIF results were produced");

let findings = 0;
for (const file of files) {
  const sarif = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(sarif.version, "2.1.0", `${file}: unsupported SARIF version`);
  assert.ok(Array.isArray(sarif.runs) && sarif.runs.length > 0, `${file}: missing SARIF runs`);
  for (const run of sarif.runs) {
    assert.ok(Array.isArray(run.results) || run.results === undefined, `${file}: invalid SARIF results`);
    findings += run.results?.length ?? 0;
  }
}

assert.equal(findings, 0, `Security analysis produced ${findings} finding(s); inspect the SARIF artifact`);
console.log(`security: ${files.length} SARIF file(s), 0 findings`);
