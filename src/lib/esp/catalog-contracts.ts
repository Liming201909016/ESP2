import { z } from "zod";
import { knowledgeBaseSchema, skillDefinitionSchema, skillQuerySchema } from "./contracts";
import { evaluationProfileSchema, evaluationRuntimeSchema } from "./skill-evaluation-contracts";

export const catalogEntrySchema = skillDefinitionSchema.extend({
  knowledgeBase: knowledgeBaseSchema.optional(),
  evaluation: evaluationProfileSchema.nullable().default(null),
  implementation: z.enum(["knowledge", "ticket_lookup", "ticket_create", "unavailable"]),
  storageBackend: z.enum(["blob", "postgres"]).nullable().default(null),
  inputLocation: z.enum(["request", "parameters"]),
  inputSchema: z.record(z.string(), z.unknown()),
  inputs: z.array(z.object({
    name: z.string(),
    label: z.string(),
    required: z.boolean(),
    options: z.array(z.string()),
    minLength: z.number().int().nonnegative().nullable(),
    maxLength: z.number().int().nonnegative().nullable(),
    pattern: z.string().nullable(),
  })),
  resultTypes: z.array(z.string()),
  examples: z.array(z.object({
    id: z.string(),
    title: z.string(),
    query: skillQuerySchema,
    caseId: z.string().optional(),
  })),
  sources: z.array(z.object({
    id: z.string(),
    title: z.string(),
    documentNumber: z.string(),
    owner: z.string(),
    version: z.string(),
    effectiveDate: z.iso.date(),
    dataKind: z.enum(["policy", "snapshot"]),
    url: z.string().regex(/^\/knowledge\/dev-[a-z0-9-]+$/),
  })),
});

export const catalogResponseSchema = z.object({
  runtime: z.object({
    environment: z.enum(["dev", "test", "production", "unknown"]),
    identity: z.object({ displayName: z.string().max(120).nullable(), source: z.enum(["entra", "development", "none"]) }),
  }).optional(),
  skills: z.array(catalogEntrySchema),
  evaluationRuntime: evaluationRuntimeSchema.nullable().default(null),
  generatedAt: z.iso.datetime(),
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;