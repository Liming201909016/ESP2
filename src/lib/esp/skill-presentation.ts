import { translate, type Locale, type TranslationKey } from "./locale";
import { skillRegistry } from "./registry";

const englishSkills: Record<string, { name: string; description: string }> = {
  "search-company-policy": { name: "HR Policy Lookup", description: "Check leave, attendance, organizational assignments and employee balances, distinguishing policy from dated synthetic records." },
  "search-expense-policy": { name: "Travel & Expense Lookup", description: "Check travel limits, individual expenses and missing receipts. Explain approvals, payments, and actual, committed and available amounts for project-lifecycle and quarterly cost-center budgets." },
  "search-procurement-guide": { name: "Procurement Guidance", description: "Compare purchasing authorization, supplier onboarding and competing quotes; check approval blockers, orders and partial deliveries." },
  "search-security-guidance": { name: "Information Security Guidance", description: "Check data sharing, endpoint and access rules; trace reports, responses and outstanding actions in synthetic incident exercises." },
  "search-software-catalog": { name: "Enterprise Software Catalog", description: "Find enterprise software, synthetic license contracts, managed assets and service-desk snapshots; explain installation queues and renewal conditions." },
  "get-ticket-status": { name: "Ticket Status Lookup", description: "Look up IT service tickets accessible to the current user." },
  "create-it-ticket": { name: "Create IT Ticket", description: "Prepare a request with the affected person, device, impact and troubleshooting already performed; create a real DEV receipt after confirmation or approval." },
};

export function presentedSkillName(skill: { id: string; name: string; version?: string }, locale: Locale) {
  const original = skillRegistry.find((entry) => entry.id === skill.id && entry.name === skill.name && (skill.version === undefined || entry.version === skill.version));
  return locale === "en-US" && original ? englishSkills[original.id]?.name ?? skill.name : skill.name;
}

export function presentedSkillDescription(skill: { id: string; version: string; description: string }, locale: Locale) {
  const original = skillRegistry.find((entry) => entry.id === skill.id && entry.version === skill.version && entry.description === skill.description);
  return locale === "en-US" && original ? englishSkills[original.id]?.description ?? skill.description : skill.description;
}

export function presentedOperationName(operation: { operationId: string; operationName: string; version: string }, locale: Locale) {
  const names: Record<string, [string, string]> = {
    "knowledge.answer": ["检索知识", "Retrieve knowledge"], "tickets.get": ["查询工单", "Look up ticket"], "tickets.create": ["创建工单", "Create ticket"],
  };
  const entry = names[operation.operationId];
  return locale === "en-US" && operation.version === "0.1.0" && entry?.[0] === operation.operationName ? entry[1] : operation.operationName;
}

export function presentedInputLabel(input: { name: string; label: string }, locale: Locale) {
  const labels: Record<string, { original: string; key: TranslationKey }> = {
    query: { original: "业务问题", key: "businessRequest" },
    description: { original: "问题描述", key: "ticketDescription" },
    device: { original: "设备 / 应用", key: "ticketDevice" },
    impact: { original: "影响范围", key: "ticketImpact" },
    ticketId: { original: "工单编号", key: "ticketId" },
  };
  const known = Object.hasOwn(labels, input.name) ? labels[input.name] : undefined;
  return known?.original === input.label && locale === "en-US" ? translate(locale, known.key) : input.label;
}

export function skillSearchText(skill: { id: string; name: string; description: string; version: string; permissions: readonly string[]; keywords: readonly string[] }) {
  return [skill.id, skill.name, skill.description, presentedSkillName(skill, "en-US"), presentedSkillDescription(skill, "en-US"), skill.version, ...skill.permissions, ...skill.keywords].join(" ").toLowerCase();
}