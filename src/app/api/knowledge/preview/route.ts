import { NextResponse } from "next/server";
import { knowledgeErrorResponse, knowledgeHeaders, knowledgeIdentity, knowledgeJson } from "../../../../lib/esp/knowledge-api";
import { prepareKnowledgeDocument } from "../../../../lib/esp/knowledge-chunks";
import { knowledgeImportSchema } from "../../../../lib/esp/knowledge-library-contracts";
import { resolveIdentity } from "../../../../lib/esp/identity";
import { auditedResponse } from "../../../../lib/esp/audit-http";
import { auditInput } from "../../../../lib/esp/audit-operation";

export async function POST(request: Request) {
  const identity = resolveIdentity(request.headers);
  let body: unknown;
  let inputError: unknown;
  try { body = await knowledgeJson(request); } catch (error) { inputError = error; }
  const parsed = knowledgeImportSchema.safeParse(body);
  return auditedResponse(request, {
    identity, kind: "knowledge_change", action: "knowledge.preview", mutation: false, requiredPermissions: ["knowledge.read"],
    input: parsed.success ? auditInput({ content: parsed.data.content }) : { fields: [] },
  }, async () => {
  try {
    knowledgeIdentity(request, true);
    if (inputError) throw inputError;
    const input = knowledgeImportSchema.parse(body);
    const preview = prepareKnowledgeDocument(input, "kb-00000000000000000000000000000000", "preview", new Date().toISOString());
    return NextResponse.json({ content: preview.content, chunks: preview.chunks }, { headers: knowledgeHeaders });
  } catch (error) { return knowledgeErrorResponse(error); }
  });
}