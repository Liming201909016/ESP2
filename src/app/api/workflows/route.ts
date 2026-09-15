import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auditedResponse } from "../../../lib/esp/audit-http";
import { auditInput } from "../../../lib/esp/audit-operation";
import { resolveIdentity } from "../../../lib/esp/identity";
import { PluginTrialError, readPluginTrialJson } from "../../../lib/esp/plugin-trial";
import { executeTicketGuidance, WorkflowAccessError, workflowSkills } from "../../../lib/esp/workflow";
import { ticketGuidanceWorkflow, workflowCatalogSchema, workflowRequestSchema } from "../../../lib/esp/workflow-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const identity = resolveIdentity(request.headers);
  if (!identity.authenticated) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  try {
    workflowSkills(identity);
    return NextResponse.json(workflowCatalogSchema.parse({ workflows: [ticketGuidanceWorkflow] }), { headers });
  } catch (error) {
    if (error instanceof WorkflowAccessError && error.status === 403) return NextResponse.json({ workflows: [] }, { headers });
    return NextResponse.json({ error: "WORKFLOW_UNAVAILABLE" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const identity = resolveIdentity(request.headers);
  if (!identity.authenticated) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  try {
    workflowSkills(identity);
    const input = workflowRequestSchema.parse(await readPluginTrialJson(request));
    return auditedResponse(request, {
      identity, kind: "skill_request", action: "workflow.ticket_guidance", mutation: false,
      input: auditInput({ query: input.query }), requiredPermissions: [...ticketGuidanceWorkflow.permissions],
      references: workflowSkills(identity).flatMap(({ skill, operation }) => [
        { type: "skill" as const, id: skill.id, version: skill.version }, { type: "plugin" as const, id: operation.pluginId },
      ]),
    }, async (context) => {
      const workflow = await executeTicketGuidance(input, identity, context);
      const trace = workflow.steps.map((step) => ({ step: `workflow.${step.id}.${step.status}${step.skipReason ? `.${step.skipReason}` : ""}`, at: step.completedAt ?? new Date().toISOString() }));
      return NextResponse.json({ requestId: context.requestId, executionStatus: workflow.executionStatus, workflow, trace }, { status: workflow.executionStatus === "failed" ? 502 : 200, headers });
    });
  } catch (error) {
    if (error instanceof WorkflowAccessError || error instanceof PluginTrialError) return NextResponse.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_WORKFLOW_REQUEST" }, { status: 400, headers });
    return NextResponse.json({ error: "WORKFLOW_UNAVAILABLE" }, { status: 502, headers });
  }
}