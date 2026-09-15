import { z } from "zod";

export const blobConnectorId = "blob-knowledge" as const;
export const connectorSourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);
export const connectorProvenanceSchema = z.object({
  connectorId: z.literal(blobConnectorId), sourceId: connectorSourceIdSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  manifestEtag: z.string().min(1).max(200), contentEtag: z.string().min(1).max(200), syncedAt: z.iso.datetime(),
}).strict();

export type ConnectorProvenance = z.infer<typeof connectorProvenanceSchema>;