import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveIdentity, type IdentityContext } from "./identity";
import { KnowledgeDocumentError } from "./knowledge-document-store";

export const knowledgeHeaders = { "Cache-Control": "private, no-store" };

export class KnowledgeRequestError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export function canManageKnowledge(identity: IdentityContext) {
  return identity.source === "development" && identity.permissions.includes("knowledge.read") &&
    process.env.ESP_ENVIRONMENT === "dev" && process.env.ESP_DEV_AUTH_BYPASS === "true";
}

export function knowledgeIdentity(request: Request, manage = false) {
  const identity = resolveIdentity(request.headers);
  if (!identity.authenticated) throw new KnowledgeRequestError("AUTHENTICATION_REQUIRED", 401);
  if (!identity.permissions.includes("knowledge.read")) throw new KnowledgeRequestError("PERMISSION_REQUIRED", 403);
  if (manage && (!identity.subject || !canManageKnowledge(identity))) throw new KnowledgeRequestError("DEV_MANAGEMENT_REQUIRED", 403);
  return identity;
}

export async function knowledgeJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new KnowledgeRequestError("JSON_REQUIRED", 415);
  }
  if (!request.body) throw new KnowledgeRequestError("INVALID_REQUEST", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 262_144) {
        await reader.cancel();
        throw new KnowledgeRequestError("DOCUMENT_TOO_LARGE", 413);
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new KnowledgeRequestError("INVALID_REQUEST", 400); }
}

export function knowledgeErrorResponse(error: unknown) {
  if (error instanceof KnowledgeRequestError) return NextResponse.json({ error: error.code }, { status: error.status, headers: knowledgeHeaders });
  if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_REQUEST", details: error.flatten() }, { status: 400, headers: knowledgeHeaders });
  if (error instanceof KnowledgeDocumentError) return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 409, headers: knowledgeHeaders });
  console.error("knowledge.library.failed", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "KNOWLEDGE_SERVICE_FAILED" }, { status: 502, headers: knowledgeHeaders });
}