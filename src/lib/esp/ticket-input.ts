import type { SkillParameters } from "./contracts";

export type TicketInputField = "description" | "impact";

export function missingTicketFields(parameters: SkillParameters): TicketInputField[] {
  const missing: TicketInputField[] = [];
  if (!parameters.description || parameters.description.trim().length < 3) missing.push("description");
  if (!parameters.impact) missing.push("impact");
  return missing;
}

export function ticketIdsInQuery(query: string): string[] {
  return [...new Set(
    (query.match(/\bESP-\d{8}-[A-F0-9]{8}\b/gi) ?? []).map((value) => value.toUpperCase()),
  )];
}