import { NextResponse } from "next/server";
import { approvalErrorResponse, approvalHeaders } from "../../../lib/esp/approval-api";
import { ApprovalError } from "../../../lib/esp/approval-contracts";
import { listApprovals } from "../../../lib/esp/approval-store";
import { approvalSummary, canReviewApprovals, requireApprovalIdentity } from "../../../lib/esp/approval-workflow";
import { resolveIdentity } from "../../../lib/esp/identity";

export async function GET(request: Request) {
  try {
    const identity = resolveIdentity(request.headers);
    const subject = requireApprovalIdentity(identity);
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    if (cursor && cursor.length > 4_000) throw new ApprovalError("INVALID_CURSOR", 400);
    const page = await listApprovals(subject, cursor);
    return NextResponse.json({ approvals: page.approvals.map(({ record }) => approvalSummary(record)), nextCursor: page.nextCursor, canReview: canReviewApprovals(identity) }, { headers: approvalHeaders });
  } catch (error) { return approvalErrorResponse(error); }
}