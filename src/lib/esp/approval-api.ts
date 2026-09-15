import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApprovalError } from "./approval-contracts";
import { StateMaintenanceError } from "./state-config";
import { PostgresStateError } from "./postgres";

export const approvalHeaders = { "Cache-Control": "private, no-store" };

export async function approvalJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApprovalError("JSON_REQUIRED", 415);
  if (!request.body) throw new ApprovalError("INVALID_REQUEST", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 32_768) { await reader.cancel(); throw new ApprovalError("REQUEST_TOO_LARGE", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new ApprovalError("INVALID_REQUEST", 400); }
}

export function approvalErrorResponse(error: unknown) {
  if (error instanceof PostgresStateError && error.code === "POSTGRES_COMMIT_UNCERTAIN") return NextResponse.json({ error: error.code, executionStatus: "execution_unknown" }, { status: 502, headers: approvalHeaders });
  if (error instanceof StateMaintenanceError) return NextResponse.json({ error: error.code }, { status: 503, headers: approvalHeaders });
  if (error instanceof ApprovalError) return NextResponse.json({ error: error.code }, { status: error.status, headers: approvalHeaders });
  if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_REQUEST", details: error.flatten() }, { status: 400, headers: approvalHeaders });
  console.error("approval.service.failed", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "APPROVAL_SERVICE_FAILED" }, { status: 502, headers: approvalHeaders });
}