import { z } from "zod";

export const demoCases = [
  { id: "DEMO-001", title: "出差制度与年假核对", requiresTicket: false, expected: "parallel", skills: ["search-expense-policy", "search-company-policy"], plugins: ["knowledge"], knowledgeBases: ["finance", "enterprise"] },
  { id: "DEMO-002", title: "出差准备与 IT 工单", requiresTicket: true, expected: "parallel", skills: ["search-expense-policy", "search-company-policy", "get-ticket-status"], plugins: ["knowledge", "tickets"], knowledgeBases: ["finance", "enterprise"] },
  { id: "DEMO-003", title: "不明确事项先澄清", requiresTicket: false, expected: "clarification", skills: [], plugins: [], knowledgeBases: [] },
  { id: "DEMO-004", title: "缺少身份不代入员工", requiresTicket: false, expected: "no_evidence", skills: ["search-company-policy"], plugins: ["knowledge"], knowledgeBases: ["enterprise"] },
] as const;

export type DemoCase = typeof demoCases[number];
export const demoVersion = "2026.09-demo-v1";
const ticketIdSchema = z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/);

export function demoRequest(caseId: string, ticketId?: string) {
  const selected = demoCases.find((entry) => entry.id === caseId);
  if (!selected) throw new Error("UNKNOWN_DEMO_CASE");
  const policy = "北京出差住宿上限是多少元每人每晚？连续4个工作日年假需提前几天申请？";
  const query = selected.id === "DEMO-001" ? policy
    : selected.id === "DEMO-002" ? `${policy}查询工单 ${ticketIdSchema.parse(ticketId)} 的状态。`
    : selected.id === "DEMO-003" ? "我应该查年假制度还是北京差旅标准？请让我选择其中一项。"
    : "我还剩多少天年假？";
  return { query, confirmed: false as const };
}

const skillSchema = z.object({
  id: z.string(), name: z.string(),
  knowledgeBase: z.object({ id: z.string(), indexName: z.string() }).optional(),
  sources: z.array(z.object({ id: z.string() })),
});
const ticketSchema = z.object({ id: ticketIdSchema, summary: z.string(), status: z.literal("open") });
const checkSchema = z.object({ status: z.enum(["healthy", "unavailable", "not_configured", "not_required"]) });
export const demoPreflightSchema = z.object({
  checkedAt: z.iso.datetime(),
  release: z.object({ releaseId: z.uuid(), buildId: z.string(), sourceCommit: z.string() }).nullable(),
  readiness: z.object({ status: z.enum(["ready", "degraded"]), validUntil: z.iso.datetime(), checks: z.object({ blob: checkSchema, search: checkSchema, state: checkSchema }) }).nullable(),
  skills: z.array(skillSchema), tickets: z.array(ticketSchema),
  plugins: z.array(z.object({ id: z.string(), dependencies: z.array(z.object({ id: z.string(), configured: z.boolean() })) })),
  state: z.object({ backend: z.enum(["blob", "postgres"]), writesPaused: z.boolean(), postgres: z.object({ prepared: z.boolean(), counts: z.object({ tickets: z.number().int().nonnegative(), approvals: z.number().int().nonnegative() }) }).optional() }).nullable(),
  errors: z.array(z.enum(["catalog", "readiness", "release", "state", "tickets", "plugins"])),
});
export type DemoPreflight = z.infer<typeof demoPreflightSchema>;

export async function loadDemoPreflight(read: (path: string) => Promise<unknown>): Promise<DemoPreflight> {
  const errors: DemoPreflight["errors"] = [];
  async function checked<T>(id: DemoPreflight["errors"][number], path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    try { return schema.parse(await read(path)); } catch { errors.push(id); return fallback; }
  }
  const [catalog, readiness, release, state, records, plugins] = await Promise.all([
    checked("catalog", "/api/skills", z.object({ skills: z.array(skillSchema) }), { skills: [] }),
    checked("readiness", "/api/readiness", demoPreflightSchema.shape.readiness.unwrap(), null as DemoPreflight["readiness"]),
    checked("release", "/api/release", demoPreflightSchema.shape.release.unwrap(), null as DemoPreflight["release"]),
    checked("state", "/api/state", demoPreflightSchema.shape.state.unwrap(), null as DemoPreflight["state"]),
    checked("tickets", "/api/tickets", z.object({ tickets: z.array(ticketSchema) }), { tickets: [] }),
    checked("plugins", "/api/plugins", z.object({ plugins: demoPreflightSchema.shape.plugins }), { plugins: [] }),
  ]);
  return demoPreflightSchema.parse({ checkedAt: new Date().toISOString(), skills: catalog.skills, tickets: records.tickets, plugins: plugins.plugins, readiness, release, state, errors: errors.sort() });
}

export function demoBlockers(selected: DemoCase, preflight: DemoPreflight | null, ticketId?: string, now = Date.now()): string[] {
  if (!preflight) return ["尚未完成自检"];
  const blockers: string[] = [];
  if (now - Date.parse(preflight.checkedAt) > 60_000 || now < Date.parse(preflight.checkedAt) || !preflight.readiness || Date.parse(preflight.readiness.validUntil) <= now) blockers.push("自检已过期，请重新检查");
  if (!preflight.readiness || preflight.readiness.status !== "ready" || Object.values(preflight.readiness.checks).some((check) => !["healthy", "not_required"].includes(check.status))) blockers.push("依赖尚未就绪");
  if (preflight.errors.includes("catalog")) blockers.push("技能目录不可用");
  const model = preflight.plugins.find((plugin) => plugin.id === "knowledge")?.dependencies.find((dependency) => dependency.id === "foundry");
  if (!model?.configured) blockers.push("模型配置缺失或未确认");
  if (selected.plugins.some((id) => !preflight.plugins.some((plugin) => plugin.id === id && plugin.dependencies.every((dependency) => dependency.configured)))) blockers.push("插件配置缺失或未确认");
  const needed = selected.expected === "clarification" ? ["search-company-policy", "search-expense-policy"] : [...selected.skills];
  if (needed.some((id) => !preflight.skills.some((skill) => skill.id === id))) blockers.push("当前身份缺少场景所需技能");
  for (const [skillId, base, sourceId] of [
    ["search-expense-policy", "finance", "dev-travel-approval"], ["search-company-policy", "enterprise", "dev-hr-leave"],
  ]) {
    if (!selected.skills.some((id) => id === skillId)) continue;
    const skill = preflight.skills.find((entry) => entry.id === skillId);
    if (skill?.knowledgeBase?.id !== base || skill.knowledgeBase.indexName !== (base === "finance" ? "esp-finance-dev-v1" : "esp-knowledge-dev-v1")) blockers.push(`${base === "finance" ? "财务" : "企业"}知识库绑定不符`);
    if (!skill?.sources.some((source) => source.id === sourceId)) blockers.push("缺少场景所需内置资料");
  }
  if (selected.requiresTicket && (preflight.errors.includes("tickets") || !preflight.tickets.some((ticket) => ticket.id === ticketId))) blockers.push("请选择当前身份可访问的工单");
  if (selected.requiresTicket && (!preflight.state || preflight.errors.includes("state") || preflight.state.backend === "postgres" && preflight.state.postgres?.prepared !== true)) blockers.push("工单事务状态未确认");
  return [...new Set(blockers)];
}

const usageSchema = z.object({ skillId: z.string(), invoked: z.boolean(), receiptReused: z.boolean(), executionStatus: z.string(), plugin: z.object({ id: z.string(), operationId: z.string(), effect: z.string() }).nullable(), knowledgeBase: z.object({ id: z.string() }).optional() });
const citationSchema = z.object({ id: z.string(), excerpt: z.string().min(8), url: z.string() });
const executionSchema = z.object({ type: z.string(), answer: z.string().optional(), citations: z.array(citationSchema).optional(), ticket: z.object({ id: ticketIdSchema }).optional() });
const responseSchema = z.object({
  requestId: z.uuid(), executionStatus: z.string(), skillUsage: z.array(usageSchema), execution: executionSchema.nullable().optional(),
  route: z.object({ status: z.string() }),
  parallel: z.object({ executionStatus: z.string(), tasks: z.array(z.object({ usage: usageSchema, executionStatus: z.string(), execution: executionSchema.nullable() })) }).optional(),
});

export function checkDemoResult(selected: DemoCase, value: unknown, ticketId?: string) {
  const body = responseSchema.parse(value);
  const actualSkills = body.skillUsage.map((usage) => usage.skillId).sort();
  const expectedSkills = [...selected.skills].sort();
  if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills)) throw new Error("DEMO_SKILL_MISMATCH");
  if (body.skillUsage.some((usage) => !usage.invoked || usage.receiptReused || usage.plugin?.effect !== "read")) throw new Error("DEMO_INVOCATION_MISMATCH");
  for (const usage of body.skillUsage) {
    const ticket = usage.skillId === "get-ticket-status";
    if (usage.plugin?.id !== (ticket ? "tickets" : "knowledge") || usage.plugin.operationId !== (ticket ? "tickets.get" : "knowledge.answer")) throw new Error("DEMO_PLUGIN_MISMATCH");
    if (ticket ? !!usage.knowledgeBase : usage.knowledgeBase?.id !== (usage.skillId === "search-expense-policy" ? "finance" : "enterprise")) throw new Error("DEMO_KNOWLEDGE_BASE_MISMATCH");
    if (usage.executionStatus !== (selected.expected === "no_evidence" ? "no_evidence" : "completed")) throw new Error("DEMO_TASK_MISMATCH");
  }
  if (JSON.stringify([...new Set(body.skillUsage.map((usage) => usage.plugin?.id))].sort()) !== JSON.stringify([...selected.plugins].sort())) throw new Error("DEMO_PLUGIN_MISMATCH");
  if (JSON.stringify([...new Set(body.skillUsage.flatMap((usage) => usage.knowledgeBase ? [usage.knowledgeBase.id] : []))].sort()) !== JSON.stringify([...selected.knowledgeBases].sort())) throw new Error("DEMO_KNOWLEDGE_BASE_MISMATCH");
  if (selected.expected === "clarification") {
    if (body.parallel || body.executionStatus !== "needs_input" || body.route.status !== "no_match" || body.execution?.type !== "intent_clarification") throw new Error("DEMO_CLARIFICATION_MISMATCH");
  } else if (selected.expected === "no_evidence") {
    if (body.parallel || body.route.status !== "matched" || body.executionStatus !== "no_evidence" || body.execution?.type !== "knowledge_not_found") throw new Error("DEMO_REFUSAL_MISMATCH");
  } else {
    if (body.route.status !== "parallel" || body.executionStatus !== "completed" || body.parallel?.executionStatus !== "completed" || body.parallel.tasks.length !== selected.skills.length) throw new Error("DEMO_PARALLEL_INCOMPLETE");
    if (JSON.stringify(body.parallel.tasks.map((task) => task.usage)) !== JSON.stringify(body.skillUsage) || body.parallel.tasks.some((task) => task.executionStatus !== "completed" || task.usage.executionStatus !== "completed")) throw new Error("DEMO_TASK_MISMATCH");
    for (const task of body.parallel.tasks) {
      if (task.usage.skillId === "get-ticket-status") {
        if (task.usage.plugin?.operationId !== "tickets.get" || task.execution?.type !== "ticket_status" || task.execution.ticket?.id !== ticketId) throw new Error("DEMO_TICKET_MISMATCH");
      } else {
        const finance = task.usage.skillId === "search-expense-policy";
        if (task.usage.plugin?.operationId !== "knowledge.answer" || task.execution?.type !== "knowledge_answer" || !task.execution.citations?.some((citation) => citation.id === (finance ? "dev-travel-approval" : "dev-hr-leave")) || !(finance ? /600/ : /7/).test(task.execution.answer ?? "")) throw new Error("DEMO_EVIDENCE_MISMATCH");
      }
    }
  }
  return { requestId: body.requestId, status: body.executionStatus, skillIds: actualSkills };
}