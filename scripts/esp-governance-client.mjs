import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  governanceManifestSchema,
  governanceProvenanceSchema,
  governanceRequestSchema,
  governanceResultSchemas,
} from "./esp-governance-contract.mjs";

async function waitForProcessExit(processId, timeoutMs = 2_000) {
  if (!Number.isInteger(processId)) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch {
      return;
    }
    await delay(10);
  }
  throw new Error("GOVERNANCE_CLEANUP_FAILED");
}

export async function callPackagedGovernanceTool(input, directory) {
  governanceRequestSchema.parse(input);
  try {
    const manifest = governanceManifestSchema.parse(
      JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")),
    );
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await readFile(resolve(directory, name));
      if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("PACKAGE_CHANGED");
    }
    if (Number(process.versions.node.split(".")[0]) !== manifest.nodeMajor) throw new Error("NODE_VERSION_MISMATCH");
    const response = await callGovernanceTool(input, {
      transport: new StdioClientTransport({
        command: process.execPath,
        args: [resolve(directory, "server.mjs")],
        cwd: resolve(directory),
        stderr: "ignore",
      }),
    });
    if (JSON.stringify(response.provenance) !== JSON.stringify(manifest.provenance))
      throw new Error("PROVENANCE_MISMATCH");
    return response;
  } catch {
    throw new Error("GOVERNANCE_PACKAGE_UNAVAILABLE");
  }
}

export async function callGovernanceTool(input, options = {}) {
  const request = governanceRequestSchema.parse(input);
  const timeout = z
    .number()
    .int()
    .min(1)
    .max(30_000)
    .parse(options.timeoutMs ?? 10_000);
  const transport =
    options.transport ??
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("./esp-governance-mcp-server.mjs", import.meta.url))],
      stderr: "ignore",
    });
  const closeTransport = transport.close.bind(transport);
  let closing;
  transport.close = () => (closing ??= closeTransport());
  const client = new Client({ name: "esp-governance-adapter", version: "1.0.0" });
  const abort = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("GOVERNANCE_TIMEOUT"));
    }, timeout);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        await client.connect(transport, { signal: abort.signal, timeout });
        const result = await client.callTool({ name: request.tool, arguments: {} }, undefined, {
          signal: abort.signal,
          timeout,
        });
        if (result.isError) throw new Error("GOVERNANCE_TOOL_FAILED");
        return {
          repositoryId: request.repositoryId,
          tool: request.tool,
          result: governanceResultSchemas[request.tool].parse(result.structuredContent),
          ...(result._meta?.espProvenance
            ? { provenance: governanceProvenanceSchema.parse(result._meta.espProvenance) }
            : {}),
        };
      })(),
    ]);
  } catch {
    throw new Error(abort.signal.aborted ? "GOVERNANCE_TIMEOUT" : "GOVERNANCE_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    const processId = transport.pid;
    await client.close();
    await transport.close();
    await waitForProcessExit(processId);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valid = process.argv.length === 3 || (process.argv.length === 5 && process.argv[3] === "--package");
  const request = { repositoryId: "esp", tool: process.argv[2] };
  const operation = !valid
    ? Promise.reject(new Error("INVALID_ARGUMENTS"))
    : process.argv[4]
      ? callPackagedGovernanceTool(request, process.argv[4])
      : callGovernanceTool(request);
  operation.then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    () => {
      console.error("GOVERNANCE_REQUEST_FAILED");
      process.exitCode = 1;
    },
  );
}
