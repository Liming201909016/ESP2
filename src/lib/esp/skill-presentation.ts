import { translate, type Locale, type TranslationKey } from "./locale";
import { skillRegistry } from "./registry";

const englishSkills: Record<string, { name: string; description: string }> = {
  "search-company-policy": { name: "HR Policy & Records Lookup", description: "Look up HR policies and dated synthetic employee records. Balances are snapshots, not a live HR-system lookup." },
  "search-expense-policy": { name: "Travel, Expense & Budget Lookup", description: "Explain travel limits, expenses and budgets using policies and dated synthetic records. Does not submit claims, approve expenses or make payments." },
  "search-procurement-guide": { name: "Procurement & Order Lookup", description: "Explain purchasing rules, supplier requirements and dated synthetic order records. Does not place orders or approve suppliers." },
  "search-security-guidance": { name: "Security Policy Lookup", description: "Look up data-sharing, endpoint and access rules and synthetic incident records. This is policy guidance, not a software security review." },
  "search-software-catalog": { name: "Software & License Lookup", description: "Look up software and dated synthetic license, asset and service records. Does not purchase licenses, install software or grant access." },
  "get-ticket-status": { name: "Ticket Status Lookup", description: "Look up IT service tickets accessible to the current user." },
  "create-it-ticket": { name: "Create IT Ticket", description: "Prepare a request with the affected person, device, impact and troubleshooting already performed; create a real DEV receipt after confirmation or approval." },
};

const chineseSkillNames: Record<string, string> = {
  "search-company-policy": "人事制度与台账查询",
  "search-expense-policy": "差旅费用与预算查询",
  "search-procurement-guide": "采购流程与订单查询",
  "search-security-guidance": "信息安全规范查询",
  "search-software-catalog": "软件目录与许可查询",
};

const chineseSkillDescriptions: Record<string, string> = {
  "search-company-policy": "查询人事制度及带日期的合成员工台账；余额属于快照，不代表实时人事系统状态。",
  "search-expense-policy": "依据制度和合成台账解释差旅标准、费用与预算；不提交报销、不批准费用、不执行付款。",
  "search-procurement-guide": "查询采购规则、供应商要求及合成订单快照；不下单，不执行供应商准入审批。",
  "search-security-guidance": "查询数据共享、终端与访问规范及合成事件记录；属于规范指引，不是软件引入安全审查。",
  "search-software-catalog": "查询软件目录及合成许可、资产、服务台快照；不购买许可、不安装软件、不授予访问权限。",
};

export function presentedSkillName(skill: { id: string; name: string; version?: string }, locale: Locale) {
  const original = skillRegistry.find((entry) => entry.id === skill.id && entry.name === skill.name && (skill.version === undefined || entry.version === skill.version));
  return original ? (locale === "en-US" ? englishSkills[original.id]?.name : chineseSkillNames[original.id]) ?? skill.name : skill.name;
}

export function presentedSkillDescription(skill: { id: string; version: string; description: string }, locale: Locale) {
  const original = skillRegistry.find((entry) => entry.id === skill.id && entry.version === skill.version && entry.description === skill.description);
  return original ? (locale === "en-US" ? englishSkills[original.id]?.description : chineseSkillDescriptions[original.id]) ?? skill.description : skill.description;
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
  return [skill.id, skill.name, skill.description, presentedSkillName(skill, "en-US"), presentedSkillName(skill, "zh-CN"), presentedSkillDescription(skill, "en-US"), skill.version, ...skill.permissions, ...skill.keywords].join(" ").toLowerCase();
}