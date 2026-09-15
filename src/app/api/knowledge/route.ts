import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageKnowledge, knowledgeErrorResponse, knowledgeHeaders, knowledgeIdentity, knowledgeJson } from "../../../lib/esp/knowledge-api";
import { knowledgeDocuments } from "../../../lib/esp/knowledge-corpus";
import { listManagedDocuments } from "../../../lib/esp/knowledge-document-store";
import { builtinLibraryItem, managedLibraryDetail } from "../../../lib/esp/knowledge-library";
import { knowledgeImportSchema } from "../../../lib/esp/knowledge-library-contracts";
import { createKnowledgeDraft } from "../../../lib/esp/knowledge-publication";
import { resolveIdentity } from "../../../lib/esp/identity";
import { auditedResponse } from "../../../lib/esp/audit-http";
import { auditInput } from "../../../lib/esp/audit-operation";

export async function GET(request: Request) {
  try {
    const identity = knowledgeIdentity(request);
    const cursor = z.string().max(4_000).optional().parse(new URL(request.url).searchParams.get("cursor") ?? undefined);
    const page = await listManagedDocuments(cursor);
    return NextResponse.json({
      builtins: knowledgeDocuments.map(builtinLibraryItem),
      documents: page.documents.map((stored) => managedLibraryDetail(stored, false).entry),
      nextCursor: page.nextCursor,
      canManage: canManageKnowledge(identity),
    }, { headers: knowledgeHeaders });
  } catch (error) { return knowledgeErrorResponse(error); }
}

export async function POST(request: Request) {
  const identity = resolveIdentity(request.headers);
  let body: unknown;
  let inputError: unknown;
  try { body = await knowledgeJson(request); } catch (error) { inputError = error; }
  const parsed = knowledgeImportSchema.safeParse(body);
  return auditedResponse(request, {
    identity, kind: "knowledge_change", action: "knowledge.import", mutation: parsed.success && canManageKnowledge(identity) && Boolean(identity.subject),
    requiredPermissions: ["knowledge.read"], input: parsed.success ? auditInput({ content: parsed.data.content }) : { fields: [] },
  }, async () => {
  try {
    knowledgeIdentity(request, true);
    if (inputError) throw inputError;
    const input = knowledgeImportSchema.parse(body);
    const stored = await createKnowledgeDraft(input, identity.subject!);
    return NextResponse.json(managedLibraryDetail(stored, true), { status: 201, headers: knowledgeHeaders });
  } catch (error) { return knowledgeErrorResponse(error); }
  });
}