import { NextResponse } from "next/server";
import { z } from "zod";
import { auditedResponse } from "../../../lib/esp/audit-http";
import { seedConnectorExamples } from "../../../lib/esp/connector-blob";
import { connectorSeedRequestSchema } from "../../../lib/esp/connector-contracts";
import { ConnectorError } from "../../../lib/esp/connector-source";
import { listConnectorSources } from "../../../lib/esp/connector-sync";
import { canManageKnowledge, knowledgeErrorResponse, knowledgeHeaders, knowledgeIdentity, knowledgeJson } from "../../../lib/esp/knowledge-api";
import { resolveIdentity } from "../../../lib/esp/identity";

export async function GET(request: Request) {
  try {
    const identity = knowledgeIdentity(request);
    const cursor = z.string().max(4_000).optional().parse(new URL(request.url).searchParams.get("cursor") ?? undefined);
    return NextResponse.json(await listConnectorSources(canManageKnowledge(identity), cursor), { headers: knowledgeHeaders });
  } catch (error) {
    if (error instanceof ConnectorError) return NextResponse.json({ error: error.code }, { status: error.status, headers: knowledgeHeaders });
    return knowledgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const identity = resolveIdentity(request.headers);
  let body: unknown;
  let inputError: unknown;
  try { body = await knowledgeJson(request); } catch (error) { inputError = error; }
  const parsed = connectorSeedRequestSchema.safeParse(body);
  return auditedResponse(request, {
    identity, kind: "connector_sync", action: "connector.blob_knowledge.seed", mutation: parsed.success && canManageKnowledge(identity) && Boolean(identity.subject),
    requiredPermissions: ["knowledge.read"], references: [{ type: "connector", id: "blob-knowledge", version: "0.1.0" }],
  }, async () => {
    try {
      knowledgeIdentity(request, true); if (inputError) throw inputError; connectorSeedRequestSchema.parse(body);
      const result = await seedConnectorExamples();
      return NextResponse.json(result, { status: result.executionStatus === "failed" ? 502 : 200, headers: knowledgeHeaders });
    } catch (error) { return knowledgeErrorResponse(error); }
  });
}