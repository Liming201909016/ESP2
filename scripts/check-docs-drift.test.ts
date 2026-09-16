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

  it("rejects an advisory branch policy presented as server-enforced", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      "CONTRIBUTING.md",
      repositoryFile(files, "CONTRIBUTING.md").replace("Server-side enforcement remains", "Server-side enforcement is"),
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

  it("rejects a remediation outcome check detached from the PR head", () => {
    const changedFiles = new Map(files);
    changedFiles.set(
      ".github/workflows/closed-loop-remediation-proof.yml",
      repositoryFile(files, ".github/workflows/closed-loop-remediation-proof.yml").replace(
        "context.payload.pull_request?.head?.sha ?? context.sha",
        "context.sha",
      ),
    );
    expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changedFiles, path))).toThrow(
      "source behavior drifted",
    );
  });
});
