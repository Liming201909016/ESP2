import { ticketDetailsSchema, type SkillParameters } from "./contracts";

export const ticketApprovalPolicy = {
  id: "dev-ticket-impact-review",
  version: "1.0.0",
  name: "DEV 工单影响范围审批",
  mode: "dev-simulation",
  skillId: "create-it-ticket",
  expiresInHours: 24,
  rules: [
    { id: "individual-confirmation", impact: "individual", effect: "confirmation", reason: "仅本人受影响，确认后创建工单。" },
    { id: "team-approval", impact: "team", effect: "approval", reason: "团队受影响，需审批通过后再执行。" },
    { id: "organization-approval", impact: "organization", effect: "approval", reason: "多个团队或全公司受影响，需审批通过后再执行。" },
  ],
} as const;

export function evaluateTicketPolicy(parameters: SkillParameters) {
  const details = ticketDetailsSchema.safeParse({ description: parameters.description, device: parameters.device, impact: parameters.impact });
  if (!details.success) return null;
  const rule = ticketApprovalPolicy.rules.find((entry) => entry.impact === details.data.impact)!;
  return {
    policyId: ticketApprovalPolicy.id, version: ticketApprovalPolicy.version, ruleId: rule.id,
    effect: rule.effect, reason: rule.reason,
  };
}

export type TicketPolicyDecision = NonNullable<ReturnType<typeof evaluateTicketPolicy>>;