import { z } from "zod";
import { auditReceiptSchema } from "./audit-contracts";
import { knowledgeVerificationReasonSchema, skillQuerySchema, skillUsageSchema } from "./contracts";
import { pluginOutputSchemas } from "./plugin-contracts";

export const parallelTaskResultSchema = z.object({
  id: z.string().regex(/^read-[1-3]$/),
  requestId: z.uuid(),
  query: skillQuerySchema,
  usage: skillUsageSchema,
  executionStatus: z.enum(["completed", "needs_input", "not_found", "no_evidence", "failed"]),
  execution: z.union([pluginOutputSchemas["knowledge.answer"], pluginOutputSchemas["tickets.get"]]).nullable(),
  error: z.enum(["READ_EXECUTION_FAILED", "KNOWLEDGE_VERIFICATION_FAILED", "MODEL_RATE_LIMITED"]).optional(),
  verificationReason: knowledgeVerificationReasonSchema.optional(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime(), durationMs: z.number().nonnegative(),
  audit: auditReceiptSchema,
}).strict();

export const parallelReadResultSchema = z.object({
  mode: z.literal("parallel_read"),
  concurrency: z.literal(2),
  executionStatus: z.enum(["completed", "partial", "no_result", "failed"]),
  tasks: z.array(parallelTaskResultSchema).min(2).max(3),
}).strict().superRefine((value, context) => {
  const completed = value.tasks.filter((task) => task.executionStatus === "completed").length;
  const failures = value.tasks.filter((task) => task.executionStatus === "failed").length;
  const expected = completed === value.tasks.length ? "completed" : completed ? "partial" : failures === value.tasks.length ? "failed" : "no_result";
  if (value.executionStatus !== expected || new Set(value.tasks.map((task) => task.usage.skillId)).size !== value.tasks.length ||
    new Set(value.tasks.map((task) => task.requestId)).size !== value.tasks.length) {
    context.addIssue({ code: "custom", message: "Inconsistent parallel result" });
  }
  for (const [index, task] of value.tasks.entries()) {
    const expectedStatus = task.execution?.type === "knowledge_not_found" ? "no_evidence" : task.execution?.type === "ticket_not_found" ? "not_found"
      : task.execution?.type === "input_required" ? "needs_input" : task.execution ? "completed" : "failed";
    const operationMatches = task.execution === null || (task.usage.plugin?.operationId === "knowledge.answer"
      ? task.execution.type === "knowledge_answer" || task.execution.type === "knowledge_not_found"
      : task.usage.plugin?.operationId === "tickets.get" && ["ticket_status", "ticket_not_found", "input_required"].includes(task.execution.type));
    if (task.id !== `read-${index + 1}` || task.usage.plugin?.effect !== "read" || !["knowledge.answer", "tickets.get"].includes(task.usage.plugin.operationId) || task.usage.receiptReused || !task.usage.invoked || !operationMatches ||
      task.usage.executionStatus !== task.executionStatus || task.executionStatus !== expectedStatus ||
      (task.executionStatus === "failed") !== Boolean(task.error) || task.audit.requestId !== task.requestId ||
      (task.error === "KNOWLEDGE_VERIFICATION_FAILED") !== Boolean(task.verificationReason) ||
      (task.error === "MODEL_RATE_LIMITED") !== (task.retryAfterSeconds !== undefined) || Date.parse(task.completedAt) < Date.parse(task.startedAt)) {
      context.addIssue({ code: "custom", message: "Inconsistent parallel task", path: ["tasks", index] });
    }
  }
});

export type ParallelTaskResult = z.infer<typeof parallelTaskResultSchema>;
export type ParallelReadResult = z.infer<typeof parallelReadResultSchema>;