import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { governanceBundleSchema, governanceResultSchemas } from "./esp-governance-contract.mjs";

try {
  const bytes = await readFile(new URL("./governance-snapshot.json", import.meta.url));
  const expected = (await readFile(new URL("./snapshot.sha256", import.meta.url), "utf8")).trim();
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("SNAPSHOT_CHANGED");
  const bundle = governanceBundleSchema.parse(JSON.parse(bytes.toString("utf8")));
  const server = new McpServer({ name: "esp-governance", version: "1.0.0" });
  for (const [name, schema] of Object.entries(governanceResultSchemas)) {
    server.registerTool(
      name,
      {
        description:
          "Read the validated ESP governance snapshot collected at package creation; not a live repository scan",
        inputSchema: {},
        outputSchema: schema.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => ({
        content: [
          { type: "text", text: JSON.stringify({ provenance: bundle.provenance, result: bundle.results[name] }) },
        ],
        structuredContent: bundle.results[name],
        _meta: { espProvenance: bundle.provenance },
      }),
    );
  }
  await server.connect(new StdioServerTransport());
} catch {
  console.error("GOVERNANCE_PACKAGE_INVALID");
  process.exitCode = 1;
}
