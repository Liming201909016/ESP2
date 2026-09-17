import { expect, test } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("standalone HTTP preserves Linux Node invocation and audited MCP results", async () => {
  test.setTimeout(60_000);
  const temporary = await mkdtemp(resolve(tmpdir(), "esp-production-governance-"));
  const runtime = resolve(temporary, "runtime");
  const auditLog = resolve(temporary, "audit.jsonl");
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((done) => reservation.close(() => done()));
  let child: ReturnType<typeof spawn> | undefined;
  let closed: Promise<unknown> | undefined;
  let diagnostics = "";
  try {
    await promisify(execFile)(process.execPath, [resolve("scripts/package-governance-mcp.mjs"), runtime], {
      timeout: 20_000,
    });
    const manifest = JSON.parse(await readFile(resolve(runtime, "manifest.json"), "utf8"));
    const snapshot = JSON.parse(await readFile(resolve(runtime, "governance-snapshot.json"), "utf8"));
    const hash = createHash("sha256")
      .update(await readFile(resolve(runtime, "manifest.json")))
      .digest("hex");
    const auditSource = `exports.BlobServiceClient=class { getContainerClient(){return {getBlockBlobClient:()=>({upload:async(body)=>{require('node:fs').appendFileSync(${JSON.stringify(auditLog)},body+'\\n');return {etag:'synthetic'};}})}}};`;
    const bootstrap = `
      const {registerHooks,syncBuiltinESMExports}=require('node:module');
      const childProcess=require('node:child_process');
      const realNode=process.execPath;
      const realSpawn=childProcess.spawn;
      Object.defineProperty(process,'platform',{value:'linux'});
      Object.defineProperty(process,'execPath',{value:'/synthetic-linux/node'});
      childProcess.spawn=function(command,args,options){
        if(command!=='/synthetic-linux/node'||options.shell!==false)throw new Error('UNEXPECTED_PLATFORM_SHELL');
        return realSpawn(realNode,args,options);
      };
      syncBuiltinESMExports();
      registerHooks({
        resolve(specifier,context,next){
          if(specifier==='@azure/storage-blob'||specifier.startsWith('@azure/storage-blob-'))return {url:'esp-test:audit',shortCircuit:true};
          return next(specifier,context);
        },
        load(url,context,next){
          if(url==='esp-test:audit')return {format:'commonjs',shortCircuit:true,source:${JSON.stringify(auditSource)}};
          return next(url,context);
        }
      });
      require(${JSON.stringify(resolve(".next/standalone/server.js"))});
    `;
    child = spawn(process.execPath, ["-e", bootstrap], {
      cwd: resolve(".next/standalone"),
      env: {
        ...Object.fromEntries(
          ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"].flatMap((name) =>
            process.env[name] ? [[name, process.env[name]!]] : [],
          ),
        ),
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        ESP_ENVIRONMENT: "dev",
        ESP_DEV_AUTH_BYPASS: "true",
        ESP_DEV_PERMISSIONS: "governance.read",
        ESP_STATE_BACKEND: "blob",
        AZURE_STORAGE_ACCOUNT: "synthetic-test-only",
        ESP_GOVERNANCE_PACKAGE: runtime,
        ESP_GOVERNANCE_MANIFEST_SHA256: hash,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    closed = new Promise((done) => child!.once("close", done));
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Standalone startup deadline")), 15_000);
      let output = "";
      child!.stdout!.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-4000);
        if (output.includes("Ready in")) {
          clearTimeout(timer);
          done();
        }
      });
      child!.stderr!.on("data", (chunk) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-6000);
      });
      child!.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child!.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Standalone exited before ready"));
      });
    });
    for (const skillId of ["inspect-repository-governance", "get-repository-validation-plan"]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/governance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: "esp", skillId }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.text();
      expect(response.status, diagnostics + "\n" + payload.slice(0, 1000)).toBe(200);
      const body = JSON.parse(payload);
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.skillId).toBe(skillId);
      expect(body.audit.status).toBe("recorded");
      expect(body.provenance).toEqual(manifest.provenance);
      expect(body.result).toEqual(snapshot.results[body.tool]);
      const entries = (await readFile(auditLog, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const pair = entries.filter((entry) => entry.id === body.audit.id);
      expect(pair).toHaveLength(2);
      expect(pair[0].mutation).toBe(false);
      expect(pair[1].status).toBe("completed");
    }
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (closed) await closed;
    await rm(temporary, { recursive: true, force: true });
  }
});
