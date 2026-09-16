import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { callPackagedGovernanceTool } from "../../../scripts/esp-governance-client.mjs";
import {
  governanceManifestSchema,
  governanceProvenanceSchema,
  governanceResultSchemas,
} from "../../../scripts/esp-governance-contract.mjs";
import { runAudited, type AuditWriter } from "./audit-operation";
import { auditWriter } from "./audit-store";
import type { IdentityContext } from "./identity";
import {
  governanceCatalogSchema,
  governanceInvocationSchema,
  governanceResponseSchema,
  governanceSkills,
  type GovernanceResponse,
} from "./governance-contracts";

export class GovernanceError extends Error {
  constructor(
    public code: "AUTHENTICATION_REQUIRED" | "PERMISSION_REQUIRED" | "INVALID_REQUEST" | "GOVERNANCE_UNAVAILABLE",
    public status: number,
  ) {
    super(code);
  }
}
export function requireGovernanceIdentity(identity: IdentityContext) {
  if (!identity.authenticated) throw new GovernanceError("AUTHENTICATION_REQUIRED", 401);
  if (!identity.subject || identity.source === "none" || !identity.permissions.includes("governance.read"))
    throw new GovernanceError("PERMISSION_REQUIRED", 403);
}

async function trustedPackage() {
  const directory = process.env.ESP_GOVERNANCE_PACKAGE;
  const expected = process.env.ESP_GOVERNANCE_MANIFEST_SHA256;
  if (!directory || !isAbsolute(directory) || !expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new GovernanceError("GOVERNANCE_UNAVAILABLE", 503);
  const bytes = await readFile(resolve(directory, "manifest.json"));
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new GovernanceError("GOVERNANCE_UNAVAILABLE", 503);
  return { directory, manifest: governanceManifestSchema.parse(JSON.parse(bytes.toString("utf8"))) };
}

export async function governanceCatalog(identity: IdentityContext) {
  requireGovernanceIdentity(identity);
  const skills = governanceSkills.map(({ id, version }) => ({
    id,
    version,
    permission: "governance.read" as const,
    effect: "read" as const,
    mode: "packaged_snapshot" as const,
  }));
  try {
    const { manifest } = await trustedPackage();
    return governanceCatalogSchema.parse({
      skills,
      packageStatus: "manifest_verified",
      provenance: manifest.provenance,
    });
  } catch {
    return governanceCatalogSchema.parse({
      skills,
      packageStatus: process.env.ESP_GOVERNANCE_PACKAGE ? "unavailable" : "not_configured",
      provenance: null,
    });
  }
}

export async function executeGovernance(
  input: unknown,
  identity: IdentityContext,
  dependencies: { writer?: AuditWriter; invoke?: typeof callPackagedGovernanceTool } = {},
) {
  requireGovernanceIdentity(identity);
  const parsed = governanceInvocationSchema.safeParse(input);
  if (!parsed.success) throw new GovernanceError("INVALID_REQUEST", 400);
  const selected = governanceSkills.find((skill) => skill.id === parsed.data.skillId)!;
  const references = [
    { type: "skill" as const, id: selected.id, version: selected.version },
    { type: "plugin" as const, id: "esp-governance-mcp", version: "1.0.0" },
  ];
  const { value, receipt } = await runAudited<
    { ok: true; result: GovernanceResponse["result"]; provenance: GovernanceResponse["provenance"] } | { ok: false }
  >(
    {
      identity,
      kind: "skill_request",
      action: "governance.read",
      mutation: false,
      requireAuditStart: true,
      requiredPermissions: ["governance.read"],
      references,
    },
    async () => {
      try {
        const { directory, manifest } = await trustedPackage();
        const response = await (dependencies.invoke ?? callPackagedGovernanceTool)(
          { repositoryId: "esp", tool: selected.tool },
          directory,
        );
        const provenance = governanceProvenanceSchema.parse(response.provenance);
        if (
          response.repositoryId !== "esp" ||
          response.tool !== selected.tool ||
          JSON.stringify(provenance) !== JSON.stringify(manifest.provenance)
        )
          throw new Error("RESPONSE_MISMATCH");
        const result = governanceResultSchemas[selected.tool].parse(response.result);
        const at = new Date().toISOString();
        return {
          value: { ok: true as const, result, provenance },
          outcome: {
            status: "completed" as const,
            httpStatus: 200,
            requiredPermissions: ["governance.read" as const],
            references,
            trace: [
              { step: "governance.snapshot.read", at },
              { step: `governance.commit.${provenance.sourceCommit}`, at },
              { step: `governance.inputs.${provenance.inputDigest}`, at },
            ],
          },
        };
      } catch {
        return {
          value: { ok: false as const },
          outcome: {
            status: "failed" as const,
            httpStatus: 503,
            errorCode: "GOVERNANCE_UNAVAILABLE",
            requiredPermissions: ["governance.read" as const],
            references,
            trace: [{ step: "governance.read.failed", at: new Date().toISOString() }],
          },
        };
      }
    },
    dependencies.writer ?? auditWriter,
  );
  if (!value.ok) return { status: 503, body: { error: "GOVERNANCE_UNAVAILABLE", audit: receipt } };
  return {
    status: 200,
    body: governanceResponseSchema.parse({
      repositoryId: "esp",
      skillId: selected.id,
      tool: selected.tool,
      result: value.result,
      provenance: value.provenance,
      audit: receipt,
    }),
  };
}
