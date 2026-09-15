import { NextResponse } from "next/server";
import { auditedResponse } from "../../../../../lib/esp/audit-http";
import { connectorSyncRequestSchema } from "../../../../../lib/esp/connector-contracts";
import { blobConnectorId, connectorSourceIdSchema } from "../../../../../lib/esp/connector-reference";
import { ConnectorError } from "../../../../../lib/esp/connector-source";
import { connectorDetails, syncConnectorSource } from "../../../../../lib/esp/connector-sync";
import { resolveIdentity } from "../../../../../lib/esp/identity";
import { canManageKnowledge, knowledgeErrorResponse, knowledgeHeaders, knowledgeIdentity, knowledgeJson } from "../../../../../lib/esp/knowledge-api";

type Context = { params: Promise<{ sourceId: string }> };
function errorResponse(error: unknown) {
  if (error instanceof ConnectorError) return NextResponse.json({ error: error.code }, { status: error.status, headers: knowledgeHeaders });
  return knowledgeErrorResponse(error);
}

export async function GET(request: Request, context: Context) {
  try {
    const identity = knowledgeIdentity(request);
    const id = connectorSourceIdSchema.parse((await context.params).sourceId);
    return NextResponse.json(await connectorDetails(id, canManageKnowledge(identity)), { headers: knowledgeHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  const identity = resolveIdentity(request.headers);
  const id = connectorSourceIdSchema.safeParse((await context.params).sourceId);
  let body: unknown;
  let inputError: unknown;
  try { body = await knowledgeJson(request); } catch (error) { inputError = error; }
  const parsed = connectorSyncRequestSchema.safeParse(body);
  return auditedResponse(request, {
    identity, kind: "connector_sync", action: "connector.blob_knowledge.sync",
    mutation: id.success && parsed.success && canManageKnowledge(identity) && Boolean(identity.subject), requiredPermissions: ["knowledge.read"],
    references: [{ type: "connector", id: blobConnectorId, version: "0.1.0" }, ...(id.success ? [{ type: "connector_source" as const, id: id.data }] : [])],
  }, async () => {
    try {
      knowledgeIdentity(request, true);
      if (inputError) throw inputError;
      if (!id.success) throw new ConnectorError("INVALID_SOURCE_PATH", 400);
      const result = await syncConnectorSource(id.data, connectorSyncRequestSchema.parse(body), identity.subject!);
      const status = result.sync.outcome !== "failed" ? 200 : result.sync.error === "SOURCE_CHANGED" || result.sync.error === "SYNC_TARGET_CONFLICT" ? 409 : 502;
      return NextResponse.json(result, { status, headers: knowledgeHeaders });
    } catch (error) { return errorResponse(error); }
  });
}