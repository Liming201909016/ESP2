import { z } from "zod";
import { knowledgeBaseSchema } from "./contracts";
import { knowledgeSkillIds } from "./knowledge-corpus";
import { auditReceiptSchema } from "./audit-contracts";
import { connectorProvenanceSchema } from "./connector-reference";

export const knowledgeImportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  skillId: z.enum(knowledgeSkillIds),
  documentNumber: z.string().trim().regex(/^SIM-[A-Z0-9-]{3,60}$/),
  owner: z.string().trim().min(1).max(80),
  effectiveDate: z.iso.date(),
  dataKind: z.enum(["policy", "snapshot"]),
  filename: z.string().max(120).regex(/^[^/\\\u0000-\u001f]+\.(?:txt|md)$/i),
  content: z.string().max(48_000)
    .transform((value) => value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(10).max(48_000).refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/u.test(value), "Expected valid UTF-8 text")),
  simulated: z.literal(true),
}).strict();

export const knowledgeChunkSchema = z.object({
  id: z.string().regex(/^kb-[a-f0-9]{32}-c\d{3}$/),
  number: z.number().int().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  content: z.string().min(1).max(1_800),
});

export const managedDocumentIdSchema = z.string().regex(/^kb-[a-f0-9]{32}$/);
export const managedDocumentSchema = z.object({
  id: managedDocumentIdSchema,
  title: z.string().min(1).max(120),
  skillId: z.enum(knowledgeSkillIds),
  documentNumber: z.string().regex(/^SIM-[A-Z0-9-]{3,60}$/),
  owner: z.string().min(1).max(80),
  effectiveDate: z.iso.date(),
  dataKind: z.enum(["policy", "snapshot"]),
  filename: z.string().min(1).max(120),
  content: z.string().min(10).max(48_000),
  chunks: z.array(knowledgeChunkSchema).min(1).max(60),
  status: z.enum(["draft", "indexing", "published", "inactive", "error"]),
  operation: z.enum(["publish", "deactivate"]).optional(),
  lastError: z.string().max(160).optional(),
  version: z.literal("1"),
  simulated: z.literal(true),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  provenance: connectorProvenanceSchema.optional(),
});

export const documentActionSchema = z.object({
  action: z.enum(["publish", "deactivate"]),
  etag: z.string().min(1).max(200),
}).strict();

export type KnowledgeImport = z.infer<typeof knowledgeImportSchema>;
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;
export type ManagedDocument = z.infer<typeof managedDocumentSchema>;
export type StoredDocument = { document: ManagedDocument; etag: string };

export const libraryItemSchema = z.object({
  knowledgeBase: knowledgeBaseSchema.optional(),
  id: z.string().regex(/^(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32})$/),
  origin: z.enum(["builtin", "imported"]),
  title: z.string(),
  skillId: z.enum(knowledgeSkillIds),
  documentNumber: z.string(),
  owner: z.string(),
  effectiveDate: z.iso.date(),
  dataKind: z.enum(["policy", "snapshot"]),
  version: z.string(),
  status: managedDocumentSchema.shape.status,
  chunkCount: z.number().int().positive(),
  updatedAt: z.string(),
  filename: z.string(),
  lastError: z.string().optional(),
  operation: managedDocumentSchema.shape.operation,
});

export const libraryListSchema = z.object({
  builtins: z.array(libraryItemSchema),
  documents: z.array(libraryItemSchema),
  nextCursor: z.string().nullable(),
  canManage: z.boolean(),
});

export const libraryDetailSchema = z.object({
  audit: auditReceiptSchema.optional(),
  provenance: connectorProvenanceSchema.optional(),
  entry: libraryItemSchema,
  content: z.string(),
  chunks: z.array(z.object({ id: z.string(), number: z.number(), start: z.number(), end: z.number(), content: z.string() })),
  etag: z.string().nullable(),
  canManage: z.boolean(),
});

export type LibraryItem = z.infer<typeof libraryItemSchema>;
export type LibraryList = z.infer<typeof libraryListSchema>;
export type LibraryDetail = z.infer<typeof libraryDetailSchema>;