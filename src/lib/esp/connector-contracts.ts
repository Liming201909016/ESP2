import { z } from "zod";
import { auditReceiptSchema } from "./audit-contracts";
import { blobConnectorId, connectorSourceIdSchema } from "./connector-reference";
import { connectorManifestSchema } from "./connector-source";
import { knowledgeChunkSchema, knowledgeImportSchema, libraryDetailSchema, managedDocumentIdSchema } from "./knowledge-library-contracts";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const connectorVersionSchema = z.object({ manifestEtag: z.string().min(1).max(200), contentEtag: z.string().min(1).max(200), fingerprint: hashSchema });
export const connectorSyncRequestSchema = connectorVersionSchema.extend({ action: z.literal("sync"), stateEtag: z.string().min(1).max(200).nullable() }).strict();
export const connectorRunSchema = z.object({
  id: z.uuid(), startedAt: z.iso.datetime(), completedAt: z.iso.datetime(), actor: z.string().min(1),
  outcome: z.enum(["created", "reused", "failed"]), fingerprint: hashSchema,
  documentId: managedDocumentIdSchema, error: z.string().regex(/^[A-Z_]{1,80}$/).optional(),
});
export const connectorStateSchema = z.object({
  connectorId: z.literal(blobConnectorId), sourceId: connectorSourceIdSchema, status: z.enum(["idle", "syncing", "error"]), updatedAt: z.iso.datetime(),
  lastSuccess: connectorVersionSchema.extend({ documentId: managedDocumentIdSchema, at: z.iso.datetime() }).nullable(),
  activeRun: z.object({ id: z.uuid(), startedAt: z.iso.datetime(), actor: z.string().min(1), fingerprint: hashSchema, documentId: managedDocumentIdSchema }).nullable(),
  lastError: z.string().regex(/^[A-Z_]{1,80}$/).optional(), history: z.array(connectorRunSchema).max(20),
}).strict();

export const connectorSourceSchema = connectorVersionSchema.extend({
  id: connectorSourceIdSchema, metadata: connectorManifestSchema, input: knowledgeImportSchema,
  documentId: managedDocumentIdSchema, bytes: z.number().int().nonnegative().max(160_000), modifiedAt: z.iso.datetime(), chunks: z.array(knowledgeChunkSchema),
});
export const connectorDetailSchema = z.object({
  sourceId: connectorSourceIdSchema, source: connectorSourceSchema.nullable(), sourceError: z.string().nullable(),
  state: connectorStateSchema.nullable(), stateEtag: z.string().nullable(), document: libraryDetailSchema.nullable(),
  change: z.enum(["new", "changed", "unchanged", "unavailable"]), canSync: z.boolean(),
});
export const connectorItemSchema = z.object({
  id: connectorSourceIdSchema, title: z.string(), filename: z.string().nullable(), documentNumber: z.string().nullable(), skillId: z.string().nullable(),
  change: z.enum(["new", "changed", "unchanged", "unavailable"]), syncStatus: connectorStateSchema.shape.status.nullable(),
  modifiedAt: z.iso.datetime().nullable(), lastDocumentId: managedDocumentIdSchema.nullable(), error: z.string().nullable(),
});
export const connectorListSchema = z.object({
  connector: z.object({ id: z.literal(blobConnectorId), name: z.string(), version: z.literal("0.1.0"), configured: z.boolean(), container: z.literal("audit"), prefix: z.literal("connector-sources/knowledge/"), mode: z.literal("dev-simulation") }),
  sources: z.array(connectorItemSchema), nextCursor: z.string().nullable(), canSync: z.boolean(),
});
export const connectorSyncResponseSchema = z.object({
  audit: auditReceiptSchema.optional(), executionStatus: z.enum(["completed", "failed"]),
  sync: z.object({ outcome: z.enum(["created", "reused", "failed"]), documentId: managedDocumentIdSchema, error: z.string().optional() }), detail: connectorDetailSchema,
});

export const connectorSeedRequestSchema = z.object({ action: z.literal("seed_examples") }).strict();
export const connectorSeedResponseSchema = z.object({
  audit: auditReceiptSchema.optional(), executionStatus: z.enum(["completed", "failed"]),
  examples: z.array(z.object({ sourceId: connectorSourceIdSchema, outcome: z.enum(["created", "existing", "failed"]), error: z.string().optional() })),
});

export type ConnectorState = z.infer<typeof connectorStateSchema>;
export type StoredConnectorState = { record: ConnectorState; etag: string };
export type ConnectorSource = z.infer<typeof connectorSourceSchema>;
export type ConnectorDetail = z.infer<typeof connectorDetailSchema>;
export type ConnectorList = z.infer<typeof connectorListSchema>;
export type ConnectorSyncRequest = z.infer<typeof connectorSyncRequestSchema>;
export type ConnectorSyncResponse = z.infer<typeof connectorSyncResponseSchema>;