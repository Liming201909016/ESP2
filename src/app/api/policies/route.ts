import { NextResponse } from "next/server";
import { approvalHeaders } from "../../../lib/esp/approval-api";
import { ticketApprovalPolicy } from "../../../lib/esp/approval-policy";
import { canReviewApprovals } from "../../../lib/esp/approval-workflow";
import { resolveIdentity } from "../../../lib/esp/identity";

export async function GET(request: Request) {
  const identity = resolveIdentity(request.headers);
  if (!identity.authenticated) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers: approvalHeaders });
  return NextResponse.json({ policies: identity.permissions.includes("tickets.create") ? [ticketApprovalPolicy] : [], canReview: canReviewApprovals(identity) }, { headers: approvalHeaders });
}