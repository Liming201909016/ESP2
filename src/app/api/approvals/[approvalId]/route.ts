import { NextResponse } from "next/server";
import { approvalErrorResponse, approvalHeaders, approvalJson } from "../../../../lib/esp/approval-api";
import { ApprovalError, approvalActionSchema, approvalIdSchema } from "../../../../lib/esp/approval-contracts";
import { getApproval } from "../../../../lib/esp/approval-store";
import { approvalDetails, changeApproval, requireApprovalIdentity } from "../../../../lib/esp/approval-workflow";
import { resolveIdentity } from "../../../../lib/esp/identity";
import { auditedResponse } from "../../../../lib/esp/audit-http";

type Context = { params: Promise<{ approvalId: string }> };

async function parseId(context: Context) {
  const parsed = approvalIdSchema.safeParse((await context.params).approvalId);
  if (!parsed.success) throw new ApprovalError("NOT_FOUND", 404);
  return parsed.data;
}

export async function GET(request: Request, context: Context) {
  try {
    const identity = resolveIdentity(request.headers); const subject = requireApprovalIdentity(identity);
    const stored = await getApproval(await parseId(context));
    if (!stored || stored.record.createdBy !== subject) throw new ApprovalError("NOT_FOUND", 404);
    return NextResponse.json(approvalDetails(stored, identity), { headers: approvalHeaders });
  } catch (error) { return approvalErrorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  const identity = resolveIdentity(request.headers);
  const candidateId = (await context.params).approvalId;
  let input: unknown;
  let inputError: unknown;
  try { input = await approvalJson(request); } catch (error) { inputError = error; }
  const parsed = approvalActionSchema.safeParse(input);
  return auditedResponse(request, {
    identity, kind: "approval_action", action: parsed.success ? `approval.${parsed.data.action}` : "approval.invalid",
    mutation: parsed.success && identity.authenticated && Boolean(identity.subject) && identity.permissions.includes("tickets.create"),
    requiredPermissions: ["tickets.create"], references: approvalIdSchema.safeParse(candidateId).success ? [{ type: "approval", id: candidateId }] : [],
  }, async () => {
  try {
    requireApprovalIdentity(identity, true);
    const id = await parseId(context);
    if (inputError) throw inputError;
    const action = approvalActionSchema.parse(input);
    const stored = await changeApproval(id, action, identity);
    return NextResponse.json(approvalDetails(stored, identity), { status: action.action === "execute" && stored.record.status === "execution_unknown" ? 502 : 200, headers: approvalHeaders });
  } catch (error) { return approvalErrorResponse(error); }
  });
}