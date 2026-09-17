import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { documentationLinkTargets, validateDocsDriftContract } from "./docs-drift-contract.mjs";

const root = resolve(import.meta.dirname, "..");
type DocsDriftContract = {
  schemaVersion: number;
  contracts: Array<{
    id: string;
    source: string;
    documentation: string;
    sourceTerms: string[];
    documentationTerms: string[];
    documentationHeading?: string;
    forbiddenDocumentationTerms?: string[];
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
  it("parses inline, reference and image links without treating code examples as links", () => {
    const content = [
      "[API](<docs/API guide.md#usage>) and [setup][guide].",
      "![State](public/state.png)",
      "[guide]: CONTRIBUTING.md",
      "```markdown",
      "[example](does-not-exist.md)",
      "```",
    ].join("\n\n");
    expect(documentationLinkTargets(content)).toEqual([
      "docs/API guide.md#usage",
      "CONTRIBUTING.md",
      "public/state.png",
    ]);
  });

  it("does not let historical prose or fenced headings satisfy a current-section contract", () => {
    const scopedContract = {
      schemaVersion: 1,
      contracts: [
        {
          id: "current-scope",
          source: "source.mjs",
          documentation: "guide.md",
          documentationHeading: "Current",
          sourceTerms: ["fixed behavior"],
          documentationTerms: ["verified current claim"],
        },
      ],
    };
    const validate = (content: string) =>
      validateDocsDriftContract(scopedContract, (path: string) => (path === "source.mjs" ? "fixed behavior" : content));
    expect(() => validate("## Current\nverified current claim\n\n## History\nOld claim.")).not.toThrow();
    expect(() =>
      validate(
        [
          "```markdown\n## Current\nverified current claim\n```",
          "## Current\nNo current evidence.",
          "## History\nverified current claim",
        ].join("\n\n"),
      ),
    ).toThrow("documentation drifted");
    expect(() => validate("## History\nverified current claim")).toThrow("identify one section");
    expect(() => validate("## Current\nverified current claim\n\n## Current\nDuplicate.")).toThrow(
      "identify one section",
    );
  });

  it("rejects contradictory MCP status and missing current confirmation instructions", () => {
    for (const [before, after] of [
      [
        "MCP alone is not an authorization or audit boundary",
        "No MCP adapter is currently implemented here. MCP alone is not an authorization or audit boundary",
      ],
      ['confirmationId: "<returned confirmation.id>"', "confirmed: true"],
    ]) {
      const changed = new Map(files);
      const readme = repositoryFile(files, "README.md");
      expect(readme).toContain(before);
      changed.set("README.md", readme.replace(before, after));
      expect(() => validateDocsDriftContract(contract, (path: string) => repositoryFile(changed, path))).toThrow();
    }
  });

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
