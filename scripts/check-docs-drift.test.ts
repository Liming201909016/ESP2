import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocsDriftContract } from "./docs-drift-contract.mjs";

const root = resolve(import.meta.dirname, "..");
type DocsDriftContract = {
  schemaVersion: number;
  contracts: Array<{
    id: string;
    source: string;
    documentation: string;
    sourceTerms: string[];
    documentationTerms: string[];
  }>;
};

const contract = JSON.parse(readFileSync(resolve(root, "docs", "drift-contract.json"), "utf8")) as DocsDriftContract;
const files = new Map<string, string>(
  [...new Set(contract.contracts.flatMap((entry) => [entry.source, entry.documentation]))].map((path) => [
    path,
    readFileSync(resolve(root, path), "utf8"),
  ]),
);

function repositoryFile(source: Map<string, string>, path: string) {
  const content = source.get(path);
  if (content === undefined) throw new Error(`Missing test fixture: ${path}`);
  return content;
}

describe("documentation drift contract", () => {
  it("retains single-maintainer disclosure and non-approval branch gates", () => {
    for (const [path, before, after] of [
      [".github/branch-protection.yml", "resolveReviewThreads: true", "resolveReviewThreads: false"],
      [".github/branch-protection.yml", "strictRequiredChecks: true", "strictRequiredChecks: false"],
      [".github/branch-protection.yml", "protectDeletion: true", "protectDeletion: false"],
      [".github/branch-protection.yml", "protectNonFastForward: true", "protectNonFastForward: false"],
      [".github/branch-protection.yml", "minimumApprovals: 0", "minimumApprovals: 1"],
      [".github/branch-protection.yml", "codeOwnerReview: false", "codeOwnerReview: true"],
      ["CONTRIBUTING.md", "not an independent-review guarantee", "independent review guaranteed"],
    ]) {
      const changedFiles = new Map(files);
      expect(repositoryFile(files, path)).toContain(before);
      changedFiles.set(path, repositoryFile(files, path).replace(before, after));
      expect(() => validateDocsDriftContract(contract, (name: string) => repositoryFile(changedFiles, name))).toThrow();
    }
  });
  it("accepts current workflow behavior and documentation", () => {
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(files, path))).not.toThrow();
  });

  it("rejects a documented recovery guarantee removed from implementation", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      ".github/workflows/ci-recovery.yml",
      repositoryFile(files, ".github/workflows/ci-recovery.yml").replace("run_attempt == 1", "run_attempt > 0"),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "source behavior drifted",
    );
  });

  it("rejects stale audit documentation", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      "docs/architecture.md",
      repositoryFile(files, "docs/architecture.md").replace("bounded turns and AI credits", "unbounded execution"),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "documentation drifted",
    );
  });

  it("rejects active branch enforcement presented as advisory", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      "CONTRIBUTING.md",
      repositoryFile(files, "CONTRIBUTING.md").replace("active default-branch contract", "advisory contract"),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "documentation drifted",
    );
  });

  it("rejects removal of human review from repair proposal documentation", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      "docs/architecture.md",
      repositoryFile(files, "docs/architecture.md").replace(
        "requires human review and manual application",
        "is applied automatically",
      ),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "documentation drifted",
    );
  });

  it("rejects stale Copilot review policy documentation", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      "docs/architecture.md",
      repositoryFile(files, "docs/architecture.md").replace("read-only tool set", "unrestricted tool set"),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "documentation drifted",
    );
  });

  it("rejects removal of documented release rollback behavior", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      "docs/architecture.md",
      repositoryFile(files, "docs/architecture.md").replace("redeploy-last-good", "manual recovery"),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "documentation drifted",
    );
  });
});
