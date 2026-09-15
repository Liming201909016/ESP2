import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateArchitectureValidationSequence } from "./repository-docs-contract.mjs";

const architecture = readFileSync(resolve(import.meta.dirname, "../docs/architecture.md"), "utf8");

describe("repository documentation contract", () => {
  it("accepts the complete ordered validation sequence", () => {
    expect(() => validateArchitectureValidationSequence(architecture)).not.toThrow();
  });

  it("rejects a missing findings-ledger check", () => {
    expect(() =>
      validateArchitectureValidationSequence(architecture.replace("npm run agent-findings:check", "")),
    ).toThrow("agent-findings:check");
  });
});
