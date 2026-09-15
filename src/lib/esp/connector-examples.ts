import { createHash } from "node:crypto";
import { z } from "zod";
import examples from "../../data/connector-examples.json";
import enterprisePack from "../../data/enterprise-pack.json";
import { connectorSourceIdSchema } from "./connector-reference";
import { connectorManifestSchema } from "./connector-source";
import { knowledgeImportSchema } from "./knowledge-library-contracts";

export const connectorExamples = z.array(knowledgeImportSchema.extend({ id: connectorSourceIdSchema })).length(10).parse([...examples, ...enterprisePack.connectorExamples]);

export function connectorExampleFiles(example: (typeof connectorExamples)[number]) {
  const { id, content, ...metadata } = example;
  const bytes = Buffer.from(content, "utf8");
  const manifest = connectorManifestSchema.parse({ ...metadata, contentSha256: createHash("sha256").update(bytes).digest("hex") });
  return { id, content: bytes, manifest, manifestBytes: Buffer.from(JSON.stringify(manifest), "utf8") };
}