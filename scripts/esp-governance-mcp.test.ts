import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEspGovernanceServer } from "./esp-governance-mcp.mjs";

const closeables: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(closeables.splice(0).map((closeable) => closeable.close()));
});

describe("ESP governance MCP server", () => {
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
      documentationDrift: { contractCount: 8 },
    });

    const plan = await client.callTool({ name: "esp_validation_plan", arguments: {} });
    expect(plan.structuredContent).toMatchObject({ mutatesRepository: false });
    expect((plan.structuredContent as { commands: string[] }).commands).toContain("npm run build");
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
