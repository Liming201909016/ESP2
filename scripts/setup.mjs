import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

assert.equal(Number(process.versions.node.split(".")[0]), 24, "ESP requires Node.js 24");
assert.equal(packageJson.engines?.node, ">=24 <25", "package.json Node.js contract is inconsistent");
assert.ok(existsSync(resolve(root, "package-lock.json")), "package-lock.json is required");
assert.ok(existsSync(resolve(root, "lefthook.yml")), "lefthook.yml is required");

if (process.argv.includes("--check")) {
  console.log("setup: Node.js 24, lockfile, and hook configuration verified");
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const args of [["ci"], ["run", "hooks:install"]]) {
  const result = spawnSync(npm, args, { cwd: root, env: process.env, stdio: "inherit" });
  assert.equal(result.status, 0, `${npm} ${args.join(" ")} failed`);
}

console.log("setup: dependencies and repository hooks installed");
