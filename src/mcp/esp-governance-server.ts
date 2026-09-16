import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEspGovernanceServer } from "../../scripts/esp-governance-mcp.mjs";

await createEspGovernanceServer().connect(new StdioServerTransport());
