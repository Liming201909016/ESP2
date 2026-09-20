import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildEnterprisePack } from "./generate-enterprise-data.mjs";

test("enterprise data check accepts LF and CRLF but rejects stale content without rewriting it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "esp-data-check-"));
  try {
    await mkdir(path.join(directory, "scripts"));
    await mkdir(path.join(directory, "src/data"), { recursive: true });
    const script = path.join(directory, "scripts/generate-enterprise-data.mjs");
    await copyFile(new URL("./generate-enterprise-data.mjs", import.meta.url), script);
    for (const filename of ["enterprise-data.json", "knowledge-samples.json"]) {
      await copyFile(new URL(`../src/data/${filename}`, import.meta.url), path.join(directory, "src/data", filename));
    }
    const data = JSON.parse(await readFile(path.join(directory, "src/data/enterprise-data.json"), "utf8"));
    const policies = JSON.parse(await readFile(path.join(directory, "src/data/knowledge-samples.json"), "utf8"));
    const pack = buildEnterprisePack(data, policies);
    const canonical = `${JSON.stringify(pack, null, 2)}\n`;
    const target = path.join(directory, "src/data/enterprise-pack.json");
    const stale = `${JSON.stringify({ ...pack, version: "stale-test-version" }, null, 2)}\n`;
    for (const [label, content, expectedStatus] of [
      ["LF", canonical, 0],
      ["CRLF", canonical.replaceAll("\n", "\r\n"), 0],
      ["stale content", stale, 1],
      ["stale CRLF content", stale.replaceAll("\n", "\r\n"), 1],
    ]) {
      await writeFile(target, content);
      const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, expectedStatus, `${label}: ${result.stderr}`);
      if (expectedStatus === 1) assert.match(result.stderr, /Enterprise pack is stale/);
      assert.equal(await readFile(target, "utf8"), content, `${label}: check must not rewrite data`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
