import { z } from "zod";
import { knowledgeBaseSchema, knowledgeMissingReasonSchema, knowledgeVerificationReasonSchema, permissionSchema, skillParametersSchema, skillQuerySchema, ticketDetailsSchema, ticketReceiptSchema } from "./contracts";
import { auditReceiptSchema } from "./audit-contracts";

export const pluginIdSchema = z.enum(["knowledge", "tickets"]);
export const pluginOperationIdSchema = z.enum(["knowledge.answer", "tickets.get", "tickets.create"]);

export const pluginInputSchemas = {
  "knowledge.answer": z.object({ query: skillQuerySchema }).strict(),
  "tickets.get": z.object({ query: skillQuerySchema, parameters: skillParametersSchema.pick({ ticketId: true }).default({}) }).strict(),
  "tickets.create": z.object({ query: skillQuerySchema, parameters: skillParametersSchema.omit({ ticketId: true }).default({}) }).strict(),
};

const ticketSchema = ticketReceiptSchema;
const citationSchema = z.object({
  id: z.string(), title: z.string(), section: z.string(), version: z.string(), organization: z.string(), documentNumber: z.string(),
  owner: z.string(), effectiveDate: z.iso.date(), dataKind: z.enum(["policy", "snapshot"]),
  url: z.string().regex(/^\/knowledge\/(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32}-c\d{3})$/), excerpt: z.string().min(8).max(500),
});
const knowledgeAnswerSchema = z.object({
  knowledgeBase: knowledgeBaseSchema.optional(),
  type: z.literal("knowledge_answer"), corpus: z.enum(["dev-samples", "dev-library"]), answer: z.string().min(1).max(6_000), citations: z.array(citationSchema).min(1).max(5),
});
const knowledgeMissingSchema = z.object({ type: z.literal("knowledge_not_found"), corpus: z.literal("dev-samples"), reason: knowledgeMissingReasonSchema.optional() });
const ticketStatusSchema = z.object({ type: z.literal("ticket_status"), ticket: ticketSchema });
const ticketMissingSchema = z.object({ type: z.literal("ticket_not_found"), ticketId: z.string() });
const ticketIdRequiredSchema = z.object({ type: z.literal("input_required"), field: z.literal("ticketId") });
const ticketDetailsRequiredSchema = z.object({
  type: z.literal("ticket_details_required"), parameters: skillParametersSchema, missingFields: z.array(z.enum(["description", "impact"])),
});

export const pluginOutputSchemas = {
  "knowledge.answer": z.discriminatedUnion("type", [knowledgeAnswerSchema, knowledgeMissingSchema]),
  "tickets.get": z.discriminatedUnion("type", [ticketStatusSchema, ticketMissingSchema, ticketIdRequiredSchema]),
  "tickets.create": z.discriminatedUnion("type", [z.object({ type: z.literal("ticket_created"), ticket: ticketSchema }), ticketDetailsRequiredSchema]),
};

export const pluginTrialRequestSchema = z.object({
  operationId: pluginOperationIdSchema,
  skillId: z.string().regex(/^[a-z0-9-]+$/).max(100),
  input: z.unknown(),
}).strict();

const operationCatalogSchema = z.object({
  id: pluginOperationIdSchema, name: z.string(), description: z.string(), effect: z.enum(["read", "write"]),
  permissions: z.array(permissionSchema), trialMode: z.enum(["live_read", "write_preview"]),
  skills: z.array(z.object({ id: z.string(), name: z.string(), confirmationRequired: z.boolean() })),
  inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()), resultTypes: z.array(z.string()),
  examples: z.array(z.object({
    id: z.string(), title: z.string(), skillId: z.string(), input: z.object({ query: skillQuerySchema, parameters: skillParametersSchema.optional() }),
  })),
});

export const pluginCatalogEntrySchema = z.object({
  id: pluginIdSchema, name: z.string(), description: z.string(), version: z.string(), contractVersion: z.literal("1.0"),
  runtime: z.literal("builtin"), state: z.literal("registered"), operations: z.array(operationCatalogSchema).min(1),
  dependencies: z.array(z.object({
    id: z.string(), name: z.string(), configured: z.boolean(), requiredSettings: z.array(z.object({ name: z.string(), present: z.boolean() })),
    health: z.literal("not_checked"),
  })),
});
export const pluginCatalogResponseSchema = z.object({ plugins: z.array(pluginCatalogEntrySchema), generatedAt: z.iso.datetime() });

export const pluginTrialResponseSchema = z.object({
  audit: auditReceiptSchema.optional(),
  requestId: z.uuid(), pluginId: pluginIdSchema, pluginVersion: z.string(), operationId: pluginOperationIdSchema, skillId: z.string(),
  mode: z.enum(["live_read", "write_preview"]),
  status: z.enum(["completed", "needs_input", "no_evidence", "not_found", "waiting_confirmation", "failed"]),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime(), durationMs: z.number().nonnegative(),
  execution: z.discriminatedUnion("type", [knowledgeAnswerSchema, knowledgeMissingSchema, ticketStatusSchema, ticketMissingSchema, ticketIdRequiredSchema, ticketDetailsRequiredSchema]).nullable(),
  preview: z.object({ selectedSkillId: z.literal("create-it-ticket"), query: skillQuerySchema, parameters: ticketDetailsSchema, confirmed: z.literal(false) }).nullable(),
  error: z.enum(["PLUGIN_EXECUTION_FAILED", "MODEL_RATE_LIMITED", "KNOWLEDGE_VERIFICATION_FAILED"]).optional(),
  verificationReason: knowledgeVerificationReasonSchema.optional(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
  trace: z.array(z.object({ step: z.string(), at: z.iso.datetime() })),
});

export type PluginCatalogEntry = z.infer<typeof pluginCatalogEntrySchema>;
export type PluginCatalogResponse = z.infer<typeof pluginCatalogResponseSchema>;
export type PluginTrialRequest = z.infer<typeof pluginTrialRequestSchema>;
export type PluginTrialResponse = z.infer<typeof pluginTrialResponseSchema>;