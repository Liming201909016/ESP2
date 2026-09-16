import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { exceptionRequestDigest } from "./audit-agent-exceptions.mjs";

async function githubPages(endpoint) {
  const { stdout } = await promisify(execFile)("gh", ["api", "--paginate", "--slurp", endpoint], {
    encoding: "utf8",
    maxBuffer: 20_000_000,
    timeout: 120_000,
  });
  return JSON.parse(stdout);
}
function flattenPages(pages) {
  assert.ok(Array.isArray(pages) && pages.every(Array.isArray), "Expected paginated GitHub arrays");
  return pages.flat();
}
export async function collectAgentExceptions(repository, readPages = githubPages) {
  assert.match(repository, /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/u);
  const issues = flattenPages(await readPages(`repos/${repository}/issues?state=open&per_page=100`));
  const selected = new Map();
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labelled = (issue.labels ?? []).some(
      (label) => (typeof label === "string" ? label : label.name) === "agent-exception",
    );
    if (!labelled && !String(issue.title ?? "").startsWith("[Agent exception]")) continue;
    assert.ok(Number.isSafeInteger(issue.number) && issue.number > 0, "Invalid issue number");
    selected.set(issue.number, issue);
  }
  const collected = [];
  for (const issue of selected.values()) {
    const comments = flattenPages(await readPages(`repos/${repository}/issues/${issue.number}/comments?per_page=100`));
    collected.push({ ...issue, comments, approvalDigest: exceptionRequestDigest(issue) });
  }
  return collected;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repository, outputPath] = process.argv.slice(2);
  assert.ok(repository && outputPath, "Usage: collect-agent-exceptions.mjs <owner/repo> <new-output.json>");
  const output = await open(outputPath, "wx");
  try {
    await output.writeFile(JSON.stringify(await collectAgentExceptions(repository), null, 2) + "\n");
  } finally {
    await output.close();
  }
}
