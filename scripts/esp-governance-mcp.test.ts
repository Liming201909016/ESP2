import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEspGovernanceServer, validationPlan } from "./esp-governance-mcp.mjs";
import { requiredValidationCommands, validateArchitectureValidationSequence } from "./repository-docs-contract.mjs";
import { callGovernanceTool, callPackagedGovernanceTool } from "./esp-governance-client.mjs";
import { packageGovernanceMcp } from "./package-governance-mcp.mjs";

const closeables: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(closeables.splice(0).map((closeable) => closeable.close()));
});

describe("ESP governance MCP server", () => {
  it("terminates an unresponsive process at the deadline", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      stderr: "ignore",
    });
    let pid: number | null = null;
    const start = transport.start.bind(transport);
    transport.start = async () => {
      await start();
      pid = transport.pid;
    };
    await expect(
      callGovernanceTool({ repositoryId: "esp", tool: "esp_validation_plan" }, { transport, timeoutMs: 150 }),
    ).rejects.toThrow("GOVERNANCE_TIMEOUT");
    expect(pid).not.toBeNull();
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it("rejects tool errors and malformed structured outputs without leaking details", async () => {
    for (const result of [
      { isError: true, content: [{ type: "text" as const, text: "private provider details" }] },
      { structuredContent: { schemaVersion: 1, mutatesRepository: true, commands: ["private command"] }, content: [] },
    ]) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = new McpServer({ name: "synthetic-invalid-server", version: "1.0.0" });
      closeables.push(server);
      server.registerTool("esp_validation_plan", { inputSchema: {} }, async () => result);
      await server.connect(serverTransport);
      await expect(
        callGovernanceTool({ repositoryId: "esp", tool: "esp_validation_plan" }, { transport: clientTransport }),
      ).rejects.toThrow(/^GOVERNANCE_UNAVAILABLE$/);
    }
  });
  it("runs the self-contained snapshot outside the source tree and rejects corruption", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "esp-governance-package-"));
    const destination = resolve(temporary, "runtime");
    try {
      const packaged = await packageGovernanceMcp(destination);
      const transport = () =>
        new StdioClientTransport({
          command: process.execPath,
          args: [resolve(destination, "server.mjs")],
          cwd: temporary,
          env: { NODE_PATH: "" },
          stderr: "ignore",
        });
      for (const tool of ["esp_governance_snapshot", "esp_validation_plan"]) {
        const result = await callPackagedGovernanceTool({ repositoryId: "esp", tool }, destination);
        expect(result.provenance).toEqual(packaged.manifest.provenance);
        expect(result.provenance.mode).toBe("packaged_snapshot");
        expect(result.result.schemaVersion).toBe(1);
      }
      const cli = await promisify(execFile)(
        process.execPath,
        [resolve(destination, "client.mjs"), "esp_validation_plan", "--package", destination],
        { cwd: temporary, timeout: 15_000, env: { ...process.env, NODE_PATH: "" } },
      );
      expect(JSON.parse(cli.stdout).provenance).toEqual(packaged.manifest.provenance);
      await expect(packageGovernanceMcp(destination)).rejects.toThrow();
      await writeFile(resolve(destination, "governance-snapshot.json"), "{}");
      await expect(
        callPackagedGovernanceTool({ repositoryId: "esp", tool: "esp_validation_plan" }, destination),
      ).rejects.toThrow("GOVERNANCE_PACKAGE_UNAVAILABLE");
      await expect(
        callGovernanceTool({ repositoryId: "esp", tool: "esp_validation_plan" }, { transport: transport() }),
      ).rejects.toThrow("GOVERNANCE_UNAVAILABLE");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 20_000);
  it("calls both allowlisted tools through real stdio and rejects arbitrary targets", async () => {
    for (const tool of ["esp_governance_snapshot", "esp_validation_plan"]) {
      const response = await callGovernanceTool({ repositoryId: "esp", tool });
      expect(response.tool).toBe(tool);
      expect(response.result.schemaVersion).toBe(1);
    }
    for (const input of [
      { repositoryId: "other", tool: "esp_validation_plan" },
      { repositoryId: "esp", tool: "shell" },
      { repositoryId: "esp", tool: "esp_validation_plan", command: "npm test" },
    ])
      await expect(callGovernanceTool(input)).rejects.toThrow();
  });
  it("exposes only fixed read-only governance and validation tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createEspGovernanceServer(process.cwd());
    const client = new Client({ name: "esp-governance-test", version: "1.0.0" });
    closeables.push(client, server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["esp_governance_snapshot", "esp_validation_plan"]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const snapshot = await client.callTool({ name: "esp_governance_snapshot", arguments: {} });
    expect(snapshot.structuredContent).toMatchObject({
      recovery: { mode: "containment", maxAttempts: 1 },
      codeReview: { mode: "read-only", allowedTools: ["view", "rg", "glob"] },
      documentationDrift: { contractCount: 19 },
    });

    const plan = await client.callTool({ name: "esp_validation_plan", arguments: {} });
    expect(plan.structuredContent).toMatchObject({ mutatesRepository: false });
    const commands = (plan.structuredContent as { commands: string[] }).commands;
    expect(commands.filter((command) => command !== "npm run agentic-workflows:check")).toEqual(
      requiredValidationCommands,
    );
    expect(() => validateArchitectureValidationSequence(commands.join("\n"))).not.toThrow();
    expect(() =>
      validateArchitectureValidationSequence(
        commands.filter((command) => command !== "npm run remediation:check").join("\n"),
      ),
    ).toThrow();
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    delete packageJson.scripts["agent-improvement:check"];
    expect(() => validationPlan(process.cwd(), () => JSON.stringify(packageJson))).toThrow(
      "Missing validation script: agent-improvement:check",
    );
  });

  it("launches the VS Code stdio server and exposes the read-only validation plan", async () => {
    const workspaceFolder = process.cwd();
    const config = JSON.parse(readFileSync(resolve(workspaceFolder, ".vscode/mcp.json"), "utf8")) as {
      servers: {
        "esp-governance": {
          command: string;
          args: string[];
        };
      };
    };
    const launcher = config.servers["esp-governance"];
    const client = new Client({ name: "esp-governance-stdio-test", version: "1.0.0" });
    closeables.push(client);

    await client.connect(
      new StdioClientTransport({
        command: launcher.command,
        args: launcher.args.map((arg) => arg.replace("${workspaceFolder}", workspaceFolder)),
      }),
    );

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["esp_governance_snapshot", "esp_validation_plan"]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const plan = await client.callTool({ name: "esp_validation_plan", arguments: {} });
    expect(plan.structuredContent).toMatchObject({ mutatesRepository: false });
    expect((plan.structuredContent as { commands: string[] }).commands).toContain("npm run build");
  });
});
