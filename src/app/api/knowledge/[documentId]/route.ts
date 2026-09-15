import { NextResponse } from "next/server";
import { canManageKnowledge, knowledgeErrorResponse, knowledgeHeaders, knowledgeIdentity, knowledgeJson } from "../../../../lib/esp/knowledge-api";
import { getManagedDocument, KnowledgeDocumentError } from "../../../../lib/esp/knowledge-document-store";
import { builtinLibraryDetail, managedLibraryDetail } from "../../../../lib/esp/knowledge-library";
import { documentActionSchema, managedDocumentIdSchema } from "../../../../lib/esp/knowledge-library-contracts";
import { changeKnowledgePublication, knowledgePublicationStore } from "../../../../lib/esp/knowledge-publication";
import { indexManagedChunks, removeManagedChunks } from "../../../../lib/esp/knowledge-search";
import { resolveIdentity } from "../../../../lib/esp/identity";
import { auditedResponse } from "../../../../lib/esp/audit-http";

type Context = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const identity = knowledgeIdentity(request);
    const { documentId } = await context.params;
    const builtin = builtinLibraryDetail(documentId);
    if (builtin) return NextResponse.json(builtin, { headers: knowledgeHeaders });
    if (!managedDocumentIdSchema.safeParse(documentId).success) throw new KnowledgeDocumentError("NOT_FOUND");
    const stored = await getManagedDocument(documentId);
    if (!stored) throw new KnowledgeDocumentError("NOT_FOUND");
    return NextResponse.json(managedLibraryDetail(stored, canManageKnowledge(identity)), { headers: knowledgeHeaders });
  } catch (error) { return knowledgeErrorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  const identity = resolveIdentity(request.headers);
  const { documentId } = await context.params;
  let body: unknown;
  let inputError: unknown;
  try { body = await knowledgeJson(request); } catch (error) { inputError = error; }
  const parsed = documentActionSchema.safeParse(body);
  return auditedResponse(request, {
    identity, kind: "knowledge_change", action: parsed.success ? `knowledge.${parsed.data.action}` : "knowledge.invalid",
    mutation: parsed.success && canManageKnowledge(identity) && Boolean(identity.subject), requiredPermissions: ["knowledge.read"],
    references: managedDocumentIdSchema.safeParse(documentId).success ? [{ type: "document", id: documentId }] : [],
  }, async () => {
  try {
    knowledgeIdentity(request, true);
    managedDocumentIdSchema.parse(documentId);
    if (inputError) throw inputError;
    const { action, etag } = documentActionSchema.parse(body);
    const result = await changeKnowledgePublication(documentId, action, etag, {
      ...knowledgePublicationStore, upsert: indexManagedChunks, remove: removeManagedChunks,
    });
    return NextResponse.json(managedLibraryDetail(result, true), { status: result.document.lastError ? 502 : 200, headers: knowledgeHeaders });
  } catch (error) { return knowledgeErrorResponse(error); }
  });
}