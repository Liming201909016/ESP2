import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { validateReviewPolicy } from "./agent-review-contract.mjs";
import { validateRecoveryPolicy } from "./classify-ci-recovery.mjs";
import { validateDocsDriftContract } from "./docs-drift-contract.mjs";
import { requiredValidationCommands } from "./repository-docs-contract.mjs";

export function governanceSnapshot(root, read = (path) => readFileSync(resolve(root, path), "utf8")) {
  const recovery = JSON.parse(read(".github/self-healing.json"));
  validateRecoveryPolicy(recovery);
  const codeReview = validateReviewPolicy(JSON.parse(read(".github/copilot-code-review.yml")));
  const drift = JSON.parse(read("docs/drift-contract.json"));
  validateDocsDriftContract(drift, read);
  return {
    schemaVersion: 1,
    recovery: {
      mode: recovery.mode,
      signal: recovery.signal,
      maxAttempts: recovery.maxAttempts,
      terminalAction: recovery.terminalAction,
    },
    codeReview: {
      mode: codeReview.mode,
      model: codeReview.model,
      allowedTools: codeReview.allowedTools,
      maxAiCredits: codeReview.maxAiCredits,
    },
    documentationDrift: {
      schemaVersion: drift.schemaVersion,
      contractCount: drift.contracts.length,
    },
  };
}

export function validationPlan(root, read = (path) => readFileSync(resolve(root, path), "utf8")) {
  const packageJson = JSON.parse(read("package.json"));
  const commands = requiredValidationCommands.flatMap((command) =>
    command === "npm test" ? ["npm run agentic-workflows:check", command] : [command],
  );
  for (const command of commands) {
    const script = command === "npm test" ? "test" : command.replace("npm run ", "");
    if (typeof packageJson.scripts?.[script] !== "string") throw new Error(`Missing validation script: ${script}`);
  }
  return { schemaVersion: 1, mutatesRepository: false, commands };
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createEspGovernanceServer(root = resolve(import.meta.dirname, "..")) {
  const server = new McpServer({ name: "esp-governance", version: "1.0.0" });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const governanceOutputSchema = {
    schemaVersion: z.literal(1),
    recovery: z.object({
      mode: z.literal("containment"),
      signal: z.literal("flaky-infrastructure-rerun"),
      maxAttempts: z.literal(1),
      terminalAction: z.literal("human_handoff"),
    }),
    codeReview: z.object({
      mode: z.literal("read-only"),
      model: z.literal("gpt-5.4"),
      allowedTools: z.array(z.enum(["view", "rg", "glob"])).length(3),
      maxAiCredits: z.literal(30),
    }),
    documentationDrift: z.object({ schemaVersion: z.literal(1), contractCount: z.number().int().positive() }),
  };
  const validationOutputSchema = {
    schemaVersion: z.literal(1),
    mutatesRepository: z.literal(false),
    commands: z.array(z.string().min(1)).min(1),
  };
  server.registerTool(
    "esp_governance_snapshot",
    {
      description: "Validate and return the fixed ESP recovery, code-review, and documentation-drift controls",
      inputSchema: {},
      outputSchema: governanceOutputSchema,
      annotations,
    },
    async () => toolResult(governanceSnapshot(root)),
  );
  server.registerTool(
    "esp_validation_plan",
    {
      description: "Return the non-mutating repository validation sequence without executing commands",
      inputSchema: {},
      outputSchema: validationOutputSchema,
      annotations,
    },
    async () => toolResult(validationPlan(root)),
  );
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createEspGovernanceServer();
  await server.connect(new StdioServerTransport());
}
