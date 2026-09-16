import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { governanceSnapshot, validationPlan } from "./esp-governance-mcp.mjs";
import { governanceBundleSchema, governanceManifestSchema } from "./esp-governance-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function packageGovernanceMcp(destination) {
  const inputs = new Map();
  const read = (name) => {
    const path = resolve(root, name);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error("INVALID_INPUT_PATH");
    if (!inputs.has(name)) inputs.set(name, readFileSync(path, "utf8"));
    return inputs.get(name);
  };
  const results = {
    esp_governance_snapshot: governanceSnapshot(root, read),
    esp_validation_plan: validationPlan(root, read),
  };
  const inputHashes = [...inputs]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, sha256: digest(content) }));
  const sourceCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirtyWorktree = Boolean(
    execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
  const snapshot = governanceBundleSchema.parse({
    schemaVersion: 1,
    provenance: {
      repositoryId: "esp",
      mode: "packaged_snapshot",
      sourceCommit,
      dirtyWorktree,
      collectedAt: new Date().toISOString(),
      inputDigest: digest(JSON.stringify(inputHashes)),
    },
    results,
  });
  const output = resolve(destination);
  await mkdir(output, { recursive: false });
  await build({
    entryPoints: {
      server: fileURLToPath(new URL("./esp-governance-runtime.mjs", import.meta.url)),
      client: fileURLToPath(new URL("./esp-governance-client.mjs", import.meta.url)),
    },
    outdir: output,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    sourcemap: false,
    legalComments: "eof",
    logLevel: "silent",
  });
  const body = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(resolve(output, "governance-snapshot.json"), body, { flag: "wx" });
  await writeFile(resolve(output, "snapshot.sha256"), digest(body) + "\n", { flag: "wx" });
  const manifest = governanceManifestSchema.parse({
    schemaVersion: 1,
    nodeMajor: 24,
    provenance: snapshot.provenance,
    inputHashes,
    files: {
      "server.mjs": digest(await readFile(resolve(output, "server.mjs"))),
      "client.mjs": digest(await readFile(resolve(output, "client.mjs"))),
      "governance-snapshot.json": digest(body),
    },
  });
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { directory: output, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/package-governance-mcp.mjs <new-output-directory>");
    process.exitCode = 1;
  } else
    await packageGovernanceMcp(process.argv[2]).then(
      (result) => console.log(JSON.stringify(result, null, 2)),
      () => {
        console.error("GOVERNANCE_PACKAGE_FAILED");
        process.exitCode = 1;
      },
    );
}
