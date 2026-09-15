import { z } from "zod";
import { auditInput, runAudited, type AuditContext, type AuditWriter } from "./audit-operation";
import { auditOutcome } from "./audit-http";
import { auditWriter } from "./audit-store";
import { skillDefinitionSchema, skillParametersSchema, skillQuerySchema, type RouteResult } from "./contracts";
import { executeSkill } from "./executor";
import type { IdentityContext } from "./identity";
import { KnowledgeVerificationError } from "./knowledge-grounding";
import { modelRateLimit } from "./model-rate-limit";
import { parallelReadResultSchema, type ParallelReadResult, type ParallelTaskResult } from "./parallel-read-contracts";
import { pluginOutputSchemas } from "./plugin-contracts";
import { skillPluginOperation } from "./plugin-registry";
import { skillRegistry } from "./registry";
import { describeSkillUsage } from "./skill-execution";
import { ticketIdsInQuery } from "./ticket-input";

const planSchema = z.array(z.object({
  skill: skillDefinitionSchema, query: skillQuerySchema, parameters: skillParametersSchema,
}).strict()).min(2).max(3);

export class ParallelReadPlanError extends Error {
  readonly code = "PARALLEL_READ_PLAN_INVALID";
  constructor() { super("Parallel read plan was not authorized"); this.name = "ParallelReadPlanError"; }
}

export async function executeParallelRead(
  input: Extract<RouteResult, { status: "parallel" }>["tasks"],
  identity: IdentityContext,
  parent: AuditContext,
  dependencies: { execute?: typeof executeSkill; writer?: AuditWriter } = {},
): Promise<ParallelReadResult> {
  const parsed = planSchema.safeParse(input);
  if (!identity.authenticated || !parsed.success || new Set(parsed.data.map((task) => task.skill.id)).size !== parsed.data.length) throw new ParallelReadPlanError();
  const tasks = parsed.data.map((task) => {
    const skill = skillRegistry.find((known) => known.id === task.skill.id);
    const operation = skill && skillPluginOperation(skill.id);
    if (!skill || !operation || operation.effect !== "read" || skill.confirmationRequired ||
      ![...skill.permissions, ...operation.permissions].every((permission) => identity.permissions.includes(permission))) throw new ParallelReadPlanError();
    const ticketIds = ticketIdsInQuery(task.query);
    if (operation.id === "knowledge.answer" && Object.keys(task.parameters).length ||
      operation.id === "tickets.get" && (!identity.subject || Object.keys(task.parameters).some((key) => key !== "ticketId") ||
        task.parameters.ticketId && (ticketIds.length !== 1 || ticketIds[0] !== task.parameters.ticketId))) throw new ParallelReadPlanError();
    return { ...task, skill, operation };
  });
  const execute = dependencies.execute ?? executeSkill;
  const writer = dependencies.writer ?? auditWriter;

  async function runTask(task: typeof tasks[number], index: number): Promise<ParallelTaskResult> {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const route: RouteResult = { status: "matched", skill: task.skill, confidence: null, matchedKeywords: [], requiresConfirmation: false };
    const options = {
      identity, kind: "skill_request" as const, action: "parallel.read", mutation: false, traceId: parent.traceId,
      requiredPermissions: [...task.skill.permissions], input: auditInput({ query: task.query, parameters: task.parameters }),
      references: [{ type: "skill" as const, id: task.skill.id, version: task.skill.version }],
    };
    const { value, receipt } = await runAudited(options, async ({ requestId }) => {
      let execution: ParallelTaskResult["execution"] = null;
      let executionStatus: ParallelTaskResult["executionStatus"] = "failed";
      let failure: Pick<ParallelTaskResult, "error" | "verificationReason" | "retryAfterSeconds"> = {};
      try {
        const result = await execute(task.skill.id, task.query, identity.subject ?? "unknown", {}, task.parameters);
        execution = pluginOutputSchemas[task.operation.id].parse(result);
        executionStatus = execution.type === "knowledge_not_found" ? "no_evidence" : execution.type === "ticket_not_found" ? "not_found"
          : execution.type === "input_required" ? "needs_input" : "completed";
      } catch (error) {
        const limited = modelRateLimit(error);
        failure = error instanceof KnowledgeVerificationError ? { error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: error.reason }
          : limited ? { error: "MODEL_RATE_LIMITED", ...limited } : { error: "READ_EXECUTION_FAILED" };
      }
      const usage = describeSkillUsage({ route, intent: { source: "model", parameters: task.parameters }, executionStatus, invoked: true, receiptReused: false })[0];
      const trace = [{ step: "parallel.read.started", at: startedAt }, { step: failure.verificationReason ? `knowledge.verification.${failure.verificationReason}`
        : failure.error === "MODEL_RATE_LIMITED" ? "execution.rate_limited" : `execution.${executionStatus}`, at: new Date().toISOString() }];
      const result = { id: `read-${index + 1}`, requestId, query: task.query, usage, executionStatus, execution, ...failure };
      return { value: result, outcome: auditOutcome({ ...result, route, trace }, executionStatus === "failed" ? failure.error === "MODEL_RATE_LIMITED" ? 429 : 502 : 200, options) };
    }, writer);
    return { ...value, startedAt, completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), audit: receipt };
  }

  const results: ParallelTaskResult[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await runTask(tasks[index], index);
    }
  }
  await Promise.all([worker(), worker()]);
  const completed = results.filter((task) => task.executionStatus === "completed").length;
  const failed = results.filter((task) => task.executionStatus === "failed").length;
  return parallelReadResultSchema.parse({
    mode: "parallel_read", concurrency: 2, tasks: results,
    executionStatus: completed === tasks.length ? "completed" : completed ? "partial" : failed === tasks.length ? "failed" : "no_result",
  });
}