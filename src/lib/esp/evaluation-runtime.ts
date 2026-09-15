import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { releaseMarkerSchema } from "../../../scripts/release-contract.mjs";
import { catalogDefinitions } from "./skill-catalog";
import type { Permission } from "./contracts";
import { knowledgeDataVersion, knowledgeDocuments, knowledgeIndexForSkill } from "./knowledge-corpus";
import { evaluationRuntimeSchema, type EvaluationRuntime } from "./skill-evaluation-contracts";
import { stateBackend } from "./state-config";

const knowledgeDigest = createHash("sha256").update(JSON.stringify(knowledgeDocuments)).digest("hex");

export async function getEvaluationRuntime(permissions: Permission[], options: {
  production?: boolean;
  read?: (path: string) => Promise<string>;
} = {}): Promise<EvaluationRuntime | null> {
  const skills = catalogDefinitions(permissions).map(({ id, version }) => ({ id, version }));
  if (!skills.length) return null;
  let release: EvaluationRuntime["release"] = null;
  if (options.production ?? process.env.NODE_ENV === "production") {
    try {
      const read = options.read ?? ((path: string) => readFile(path, "utf8"));
      const marker = releaseMarkerSchema.parse(JSON.parse(await read(join(process.cwd(), "public/esp-release.json"))));
      const buildId = (await read(join(process.cwd(), ".next/BUILD_ID"))).trim();
      if (marker.buildId === buildId && marker.knowledgeVersion === knowledgeDataVersion) {
        release = { releaseId: marker.releaseId, buildId, sourceCommit: marker.sourceCommit };
      }
    } catch { release = null; }
  }
  const configurationDigest = createHash("sha256").update(JSON.stringify({
    environment: process.env.ESP_ENVIRONMENT ?? null,
    developmentBypass: process.env.ESP_DEV_AUTH_BYPASS === "true",
    stateBackend: stateBackend(), writesPaused: process.env.ESP_STATE_WRITES_PAUSED === "true",
    modelEndpoint: process.env.AZURE_AI_ENDPOINT ?? null, modelDeployment: process.env.AZURE_AI_CHAT_DEPLOYMENT ?? null,
    searchEndpoint: process.env.AZURE_SEARCH_ENDPOINT ?? null, storageAccount: process.env.AZURE_STORAGE_ACCOUNT ?? null,
    knowledgeBindings: skills.map((skill) => ({ skillId: skill.id, index: knowledgeIndexForSkill(skill.id) })),
    permissions: [...permissions].sort(),
  })).digest("hex");
  return evaluationRuntimeSchema.parse({
    schemaVersion: 1, profileVersion: "1.0.0", release, configurationDigest,
    modelIdentity: "deployment_configuration_only", knowledge: { version: knowledgeDataVersion, digest: knowledgeDigest }, skills,
  });
}