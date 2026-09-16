import { z } from "zod";
import { auditReceiptSchema } from "./audit-contracts";
import { governanceProvenanceSchema, governanceResultSchemas } from "../../../scripts/esp-governance-contract.mjs";

export const governanceSkills = [
  { id: "inspect-repository-governance", tool: "esp_governance_snapshot", version: "1.0.0" },
  { id: "get-repository-validation-plan", tool: "esp_validation_plan", version: "1.0.0" },
] as const;
export const governanceSkillIdSchema = z.enum(["inspect-repository-governance", "get-repository-validation-plan"]);
export const governanceInvocationSchema = z
  .object({ repositoryId: z.literal("esp"), skillId: governanceSkillIdSchema })
  .strict();
export const governanceCatalogSchema = z
  .object({
    skills: z.array(
      z
        .object({
          id: governanceSkillIdSchema,
          version: z.literal("1.0.0"),
          permission: z.literal("governance.read"),
          effect: z.literal("read"),
          mode: z.literal("packaged_snapshot"),
        })
        .strict(),
    ),
    packageStatus: z.enum(["manifest_verified", "not_configured", "unavailable"]),
    provenance: governanceProvenanceSchema.nullable(),
  })
  .strict();
const responseBase = {
  repositoryId: z.literal("esp"),
  provenance: governanceProvenanceSchema,
  audit: auditReceiptSchema,
};
export const governanceResponseSchema = z.discriminatedUnion("skillId", [
  z
    .object({
      ...responseBase,
      skillId: z.literal("inspect-repository-governance"),
      tool: z.literal("esp_governance_snapshot"),
      result: governanceResultSchemas.esp_governance_snapshot,
    })
    .strict(),
  z
    .object({
      ...responseBase,
      skillId: z.literal("get-repository-validation-plan"),
      tool: z.literal("esp_validation_plan"),
      result: governanceResultSchemas.esp_validation_plan,
    })
    .strict(),
]);
export type GovernanceCatalog = z.infer<typeof governanceCatalogSchema>;
export type GovernanceResponse = z.infer<typeof governanceResponseSchema>;
