import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEspGovernanceServer } from "./esp-governance-mcp.mjs";

await createEspGovernanceServer().connect(new StdioServerTransport());
