import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSecurityReview } from "../src/lib/esp/security-review";
import {
  repositoryMarkdownPaths,
  requiredDocumentationPaths,
  requiredValidationCommands,
  validateArchitectureValidationSequence,
} from "./repository-docs-contract.mjs";

const architecture = readFileSync(resolve(import.meta.dirname, "../docs/architecture.md"), "utf8");

describe("repository documentation contract", () => {
  it("keeps the English demo request inside the actual bounded review grammar", () => {
    const demo = readFileSync(resolve(import.meta.dirname, "../HACKATHON-DEMO.md"), "utf8");
    const query = /^Employee request: \*\*([^*\r\n]+)\*\*$/mu.exec(demo)?.[1];
    expect(query).toBeDefined();
    expect(discoverSecurityReview(query ?? "")?.workflowId).toBe("software-security-review");
    expect(discoverSecurityReview(`${query} for our development team`)).toBeNull();
  });

  it("accepts the same complete ordered sequence in every validation guide", () => {
    for (const path of ["CONTRIBUTING.md", "docs/architecture.md", "docs/specs/esp-engineering-contract-v1.md"]) {
      const content = readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
      expect(() => validateArchitectureValidationSequence(content, path)).not.toThrow();
    }
  });

  it("discovers new documentation across the repository without a per-file enrollment list", () => {
    const addedPaths = [
      "guides/New guide.md",
      "src/new/AGENTS.md",
      ".github/workflows/new-audit.md",
      "guides/start.mdx",
    ];
    const existing = new Set([...requiredDocumentationPaths, ...addedPaths]);
    const paths = repositoryMarkdownPaths(
      [...existing, "README.md", "guides/deleted.md", "src/ignored.ts"],
      (path: string) => existing.has(path),
    );
    expect(paths).toEqual([...existing].sort());
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toEqual(expect.arrayContaining(addedPaths));
  });

  it("rejects a missing required entrypoint instead of silently dropping it", () => {
    expect(() => repositoryMarkdownPaths([], (path: string) => path !== "AGENTS.md")).toThrow(
      "Missing documentation file: AGENTS.md",
    );
  });

  it("rejects every omitted gate and command suffix, and preserves ordering across line endings", () => {
    for (const command of requiredValidationCommands) {
      expect(() =>
        validateArchitectureValidationSequence(architecture.replaceAll(command, `${command}:not-the-gate`)),
      ).toThrow(command);
    }
    const reversed = [...requiredValidationCommands].reverse().join("\n");
    expect(() => validateArchitectureValidationSequence(reversed)).toThrow("out-of-order");
    expect(() => validateArchitectureValidationSequence(requiredValidationCommands.join("\r\n"))).not.toThrow();
  });

  it("rejects a missing findings-ledger check", () => {
    expect(() =>
      validateArchitectureValidationSequence(architecture.replace("npm run agent-findings:check", "")),
    ).toThrow("agent-findings:check");
  });

  it("rejects a missing learned-rule and dashboard check", () => {
    expect(() =>
      validateArchitectureValidationSequence(architecture.replaceAll("npm run agent-improvement:check", "")),
    ).toThrow("agent-improvement:check");
  });

  it("rejects a missing closed-loop remediation check", () => {
    expect(() =>
      validateArchitectureValidationSequence(architecture.replaceAll("npm run remediation:check", "")),
    ).toThrow("remediation:check");
  });

  it("rejects a missing documentation drift gate", () => {
    expect(() => validateArchitectureValidationSequence(architecture.replace("npm run docs:drift", ""))).toThrow(
      "docs:drift",
    );
  });
});
