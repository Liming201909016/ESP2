import { z } from "zod";

export const permissionSchema = z.enum([
  "knowledge.read",
  "tickets.read",
  "tickets.create",
  "governance.read",
]);

export const skillDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["knowledge", "query", "action"]),
  permissions: z.array(permissionSchema).min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  confirmationRequired: z.boolean(),
  keywords: z.array(z.string().min(1)).min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type Permission = z.infer<typeof permissionSchema>;
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

export const skillQuerySchema = z.string().trim().min(1).max(2_000);
export const ticketImpactSchema = z.enum(["individual", "team", "organization"]);

export const skillParametersSchema = z.object({
  description: z.string().trim().max(2_000).optional(),
  device: z.string().trim().max(120).optional(),
  impact: ticketImpactSchema.optional(),
  ticketId: z.string().trim().toUpperCase().regex(/^ESP-\d{8}-[A-F0-9]{8}$/).optional(),
}).strict();

export const ticketDetailsSchema = z.object({
  description: z.string().trim().min(3).max(2_000),
  device: z.string().trim().max(120).optional(),
  impact: ticketImpactSchema,
}).strict();

export type SkillParameters = z.infer<typeof skillParametersSchema>;
export type TicketDetails = z.infer<typeof ticketDetailsSchema>;

export type IntentContext = {
  source: "keyword" | "model" | "selection";
  parameters: SkillParameters;
  question?: string;
  choices?: { id: string; name: string }[];
  notice?: "manual_input";
};

export const ticketReceiptSchema = z.object({
  id: z.string(), status: z.literal("open"), summary: z.string(), createdAt: z.string(), createdBy: z.string(),
  details: ticketDetailsSchema.optional(), approvalId: z.string().regex(/^apr-[a-f0-9]{32}$/).optional(),
});

export type TicketExecutionResult = { type: "ticket_created"; ticket: z.infer<typeof ticketReceiptSchema> };

export const knowledgeVerificationReasonSchema = z.enum([
  "unsupported", "incomplete", "conflicting", "stale", "invalid_review", "incomplete_review", "unverified_statement",
  "invalid_draft", "invalid_citation", "unsupported_number", "invalid_calculation",
]);
export type KnowledgeVerificationReason = z.infer<typeof knowledgeVerificationReasonSchema>;

export const knowledgeMissingReasonSchema = z.enum(["no_search_results", "no_current_evidence", "model_unsupported", "evidence_changed"]);
export type KnowledgeMissingResult = { type: "knowledge_not_found"; corpus: "dev-samples"; reason?: z.infer<typeof knowledgeMissingReasonSchema> };

export const knowledgeBaseSchema = z.discriminatedUnion("id", [
  z.object({ id: z.literal("enterprise"), name: z.literal("企业制度知识库"), indexName: z.literal("esp-knowledge-dev-v1") }).strict(),
  z.object({ id: z.literal("finance"), name: z.literal("财务差旅知识库"), indexName: z.literal("esp-finance-dev-v1") }).strict(),
]);
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

export type KnowledgeAnswerResult = {
  type: "knowledge_answer";
  corpus: "dev-samples" | "dev-library";
  knowledgeBase?: KnowledgeBase;
  answer: string;
  citations: {
    id: string;
    title: string;
    section: string;
    version: string;
    organization: string;
    documentNumber: string;
    owner: string;
    effectiveDate: string;
    dataKind: "policy" | "snapshot";
    url: string;
    excerpt: string;
  }[];
};

export type ExecutionResult =
  | TicketExecutionResult
  | KnowledgeAnswerResult
  | KnowledgeMissingResult
  | { type: "ticket_status"; ticket: TicketExecutionResult["ticket"] }
  | { type: "input_required"; field: "ticketId" }
  | { type: "ticket_details_required"; parameters: SkillParameters; missingFields: ("description" | "impact")[] }
  | { type: "intent_clarification"; question: string; choices: { id: string; name: string }[] }
  | { type: "ticket_not_found"; ticketId: string }
  | { type: "unavailable"; skillId: string };

export type ExecutionStatus =
  | "not_routed"
  | "partial"
  | "no_result"
  | "waiting_confirmation"
  | "waiting_approval"
  | "needs_input"
  | "not_found"
  | "no_evidence"
  | "unavailable"
  | "completed"
  | "failed";

export const skillUsageSchema = z.object({
  skillId: skillDefinitionSchema.shape.id,
  name: skillDefinitionSchema.shape.name,
  description: skillDefinitionSchema.shape.description,
  version: skillDefinitionSchema.shape.version,
  category: skillDefinitionSchema.shape.category,
  riskLevel: skillDefinitionSchema.shape.riskLevel,
  selectionSource: z.enum(["keyword", "model", "selection"]),
  matchedKeywords: z.array(z.string()).max(100),
  knowledgeBase: knowledgeBaseSchema.optional(),
  plugin: z.object({
    id: z.enum(["knowledge", "tickets"]), name: z.string().min(1), version: z.string().min(1),
    operationId: z.enum(["knowledge.answer", "tickets.get", "tickets.create"]),
    operationName: z.string().min(1), effect: z.enum(["read", "write"]),
  }).strict().nullable(),
  invoked: z.boolean(),
  receiptReused: z.boolean(),
  executionStatus: z.enum(["not_routed", "waiting_confirmation", "waiting_approval", "needs_input", "not_found", "no_evidence", "unavailable", "completed", "failed"]),
}).strict();

export type SkillUsage = z.infer<typeof skillUsageSchema>;

export const skillUsageResponseSchema = z.object({
  requestId: z.uuid(), skillUsage: z.array(skillUsageSchema).max(3).refine((items) => new Set(items.map((item) => item.skillId)).size === items.length, "Duplicate skill usage"),
  trace: z.array(z.object({ step: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/), at: z.iso.datetime() }).strict()).max(100).optional(),
});
export type SkillUsageResponse = z.infer<typeof skillUsageResponseSchema>;

export type RouteResult =
  | { status: "workflow"; workflowId: "ticket-handling-guidance"; version: "1.0.3" }
  | {
      status: "matched";
      skill: SkillDefinition;
  confidence: number | null;
      matchedKeywords: string[];
      requiresConfirmation: boolean;
    }
  | {
      status: "parallel";
      tasks: { skill: SkillDefinition; query: string; parameters: SkillParameters }[];
    }
  | {
      status: "no_match";
      confidence: 0;
      reason: string;
    };