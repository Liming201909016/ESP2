import { z } from "zod";

export const governanceRequestSchema = z
  .object({
    repositoryId: z.literal("esp"),
    tool: z.enum(["esp_governance_snapshot", "esp_validation_plan"]),
  })
  .strict();
export const governanceResultSchemas = {
  esp_governance_snapshot: z
    .object({
      schemaVersion: z.literal(1),
      recovery: z
        .object({
          mode: z.literal("containment"),
          signal: z.literal("flaky-infrastructure-rerun"),
          maxAttempts: z.literal(1),
          terminalAction: z.literal("human_handoff"),
        })
        .strict(),
      codeReview: z
        .object({
          mode: z.literal("read-only"),
          model: z.literal("gpt-5.4"),
          allowedTools: z.tuple([z.literal("view"), z.literal("rg"), z.literal("glob")]),
          maxAiCredits: z.literal(30),
        })
        .strict(),
      documentationDrift: z
        .object({ schemaVersion: z.literal(1), contractCount: z.number().int().positive() })
        .strict(),
    })
    .strict(),
  esp_validation_plan: z
    .object({
      schemaVersion: z.literal(1),
      mutatesRepository: z.literal(false),
      commands: z.array(z.string().min(1).max(200)).min(1).max(30),
    })
    .strict(),
};
export const governanceProvenanceSchema = z
  .object({
    repositoryId: z.literal("esp"),
    mode: z.literal("packaged_snapshot"),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    dirtyWorktree: z.boolean(),
    collectedAt: z.iso.datetime(),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const governanceBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    provenance: governanceProvenanceSchema,
    results: z.object(governanceResultSchemas).strict(),
  })
  .strict();

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const governanceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodeMajor: z.literal(24),
    provenance: governanceProvenanceSchema,
    inputHashes: z
      .array(z.object({ path: z.string().min(1).max(500), sha256: hash }).strict())
      .min(1)
      .max(1000),
    files: z.object({ "server.mjs": hash, "client.mjs": hash, "governance-snapshot.json": hash }).strict(),
  })
  .strict();
