import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stateSchemaVersion } from "../src/lib/esp/postgres-schema.ts";
import { digest, readReleaseBundle, releaseManifestSchema, releaseMarkerSchema, requireRelease } from "./release-contract.mjs";

const windows = process.platform === "win32";
const tar = windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

export function validateArchiveEntries(entries) {
  const files = new Set();
  for (const name of entries) {
    const normalized = name.replace(/^(\.\/)+/, "");
    if (!normalized || normalized === ".") continue;
    requireRelease(!normalized.startsWith("/") && !/[\\\x00-\x1f:]/.test(normalized) && !normalized.split("/").includes(".."), "UNSAFE_ARCHIVE_PATH");
    requireRelease(!normalized.split("/").some((part) => /^\.env/i.test(part)), "ENVIRONMENT_FILE_IN_ARCHIVE");
    requireRelease(!files.has(normalized), "DUPLICATE_ARCHIVE_PATH");
    files.add(normalized);
  }
  for (const required of ["server.js", ".next/BUILD_ID", "node_modules/pg/lib/index.js", "node_modules.tar.gz", "public/esp-release.json"]) requireRelease(files.has(required), "INCOMPLETE_STANDALONE_ARCHIVE");
  requireRelease([...files].some((name) => name.startsWith(".next/static/") && !name.endsWith("/")), "STATIC_ASSETS_MISSING");
}

export function readArchiveFile(path, name) {
  const entries = execFileSync(windows ? tar : "unzip", windows ? ["-tf", path] : ["-Z1", path], { encoding: "utf8", maxBuffer: 4_000_000 }).trim().split(/\r?\n/);
  validateArchiveEntries(entries);
  const entry = entries.find((item) => item.replace(/^(\.\/)+/, "") === name);
  requireRelease(Boolean(entry), "ARCHIVE_FILE_MISSING");
  return execFileSync(windows ? tar : "unzip", windows ? ["-xOf", path, entry] : ["-p", path, entry], { encoding: "utf8", maxBuffer: 65_536 });
}

export async function stampStage(stagePath, sourceCommit = "local", buildRunId = null) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pack = JSON.parse(await readFile(join(root, "src/data/enterprise-pack.json"), "utf8"));
  const application = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const release = releaseMarkerSchema.parse({
    schemaVersion: 1, application: "esp-platform", releaseId: randomUUID(), createdAt: new Date().toISOString(), sourceCommit, buildRunId,
    buildId: (await readFile(join(stagePath, ".next/BUILD_ID"), "utf8")).trim(), applicationVersion: application.version,
    nodeMajor: Number(process.versions.node.split(".")[0]), stateBackend: "postgres", stateSchemaVersion,
    knowledgeVersion: pack.version, knowledgeDigest: digest(JSON.stringify(pack.documents)),
  });
  await mkdir(join(stagePath, "public"), { recursive: true });
  await writeFile(join(stagePath, "public/esp-release.json"), `${JSON.stringify(release)}\n`, { flag: "wx" });
  return release;
}

export async function createPackageManifest(archivePath, outputPath) {
  const information = await stat(archivePath);
  requireRelease(information.size <= 500_000_000, "ARCHIVE_TOO_LARGE");
  const release = releaseMarkerSchema.parse(JSON.parse(readArchiveFile(archivePath, "public/esp-release.json")));
  requireRelease(readArchiveFile(archivePath, ".next/BUILD_ID").trim() === release.buildId, "ARCHIVE_BUILD_ID_MISMATCH");
  const manifest = releaseManifestSchema.parse({ schemaVersion: 1, release, archive: { filename: "release.zip", sha256: digest(await readFile(archivePath)), bytes: information.size } });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export async function verifyReleaseBundle(directory) {
  const manifest = await readReleaseBundle(directory);
  const archivePath = join(directory, manifest.archive.filename);
  const embedded = releaseMarkerSchema.parse(JSON.parse(readArchiveFile(archivePath, "public/esp-release.json")));
  requireRelease(JSON.stringify(embedded) === JSON.stringify(manifest.release), "PACKAGE_MARKER_MISMATCH");
  requireRelease(readArchiveFile(archivePath, ".next/BUILD_ID").trim() === embedded.buildId, "ARCHIVE_BUILD_ID_MISMATCH");
  return manifest;
}

export async function checkPackagedStartup(stagePath) {
  const expected = releaseMarkerSchema.parse(JSON.parse(await readFile(join(stagePath, "public/esp-release.json"), "utf8")));
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const address = reservation.address();
  requireRelease(address && typeof address === "object", "LOCAL_PORT_UNAVAILABLE");
  const port = address.port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [join(stagePath, "server.js")], {
    cwd: stagePath, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), ESP_ENVIRONMENT: "dev", ESP_DEV_AUTH_BYPASS: "true", ESP_DEV_PERMISSIONS: "knowledge.read,tickets.read,tickets.create", ESP_STATE_BACKEND: "blob", ESP_STATE_MIGRATE: "", ESP_KNOWLEDGE_SEED: "" },
  });
  const exited = new Promise((resolve) => child.once("close", resolve));
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Startup deadline")), 45_000);
      let output = "";
      child.stdout.on("data", (chunk) => { output = `${output}${chunk.toString()}`.slice(-4000); if (/Ready in|Listening on/i.test(output)) resolve(); });
      child.stderr.on("data", () => undefined);
      child.once("error", () => reject(new Error("Startup failed")));
      child.once("exit", () => reject(new Error("Startup exited")));
    });
    clearTimeout(timer);
    const origin = `http://127.0.0.1:${port}`;
    const markerResponse = await fetch(`${origin}/api/release`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    requireRelease(markerResponse.status === 200, "PACKAGED_MARKER_NOT_SERVED");
    const marker = releaseMarkerSchema.parse(await markerResponse.json());
    requireRelease(JSON.stringify(marker) === JSON.stringify(expected), "PACKAGED_MARKER_MISMATCH");
    const healthResponse = await fetch(`${origin}/api/health`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const health = await healthResponse.json();
    requireRelease(healthResponse.status === 200 && health.status === "healthy" && health.state?.backend === "blob", "PACKAGED_STARTUP_FAILED");
    return { startup: "verified", releaseId: marker.releaseId, dependencies: "not_probed", environment: "isolated-local-blob-mode" };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await exited;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, first, second, third] = process.argv.slice(2);
  requireRelease(Boolean(first), "PACKAGE_ARGUMENT_REQUIRED");
  if (action === "stamp") {
    const release = await stampStage(resolve(first), second ?? "local", third ?? null);
    console.log(JSON.stringify({ releaseId: release.releaseId, buildId: release.buildId }));
  } else if (action === "manifest") {
    requireRelease(Boolean(second), "MANIFEST_PATH_REQUIRED");
    const manifest = await createPackageManifest(resolve(first), resolve(second));
    console.log(JSON.stringify({ releaseId: manifest.release.releaseId, sha256: manifest.archive.sha256, bytes: manifest.archive.bytes }));
  } else if (action === "verify") {
    const manifest = await verifyReleaseBundle(resolve(first));
    console.log(JSON.stringify({ verified: true, releaseId: manifest.release.releaseId, sourceCommit: manifest.release.sourceCommit, archive: basename(manifest.archive.filename) }));
  } else if (action === "startup") {
    console.log(JSON.stringify(await checkPackagedStartup(resolve(first))));
  } else requireRelease(false, "UNKNOWN_PACKAGE_ACTION");
}