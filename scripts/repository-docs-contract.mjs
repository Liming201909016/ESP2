import assert from "node:assert/strict";

export const requiredValidationCommands = [
  "npm run data:check",
  "npm run docs:check",
  "npm run docs:drift",
  "npm run agent-findings:check",
  "npm run agent-improvement:check",
  "npm run remediation:check",
  "npm test",
  "npm run lint",
  "npm run format:check",
  "npm run build",
  "npm run test:e2e",
];

export const requiredDocumentationPaths = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "HACKATHON-BACKLOG.md",
  "HACKATHON-DEMO.md",
  "README.md",
  "SECURITY.md",
  ".github/copilot-instructions.md",
  "scripts/AGENTS.md",
  "src/lib/esp/AGENTS.md",
  "docs/architecture.md",
  "docs/specs/esp-engineering-contract-v1.md",
];

export function repositoryMarkdownPaths(paths, fileExists) {
  for (const path of requiredDocumentationPaths) {
    assert.ok(fileExists(path), `Missing documentation file: ${path}`);
  }
  return [...new Set([...requiredDocumentationPaths, ...paths])]
    .filter((path) => /\.mdx?$/iu.test(path) && fileExists(path))
    .sort();
}

export function validateArchitectureValidationSequence(content, path = "docs/architecture.md") {
  const commandLines = content.split(/\r?\n/u).map((line) => line.trim());
  let previousCommandIndex = -1;
  for (const command of requiredValidationCommands) {
    const commandIndex = commandLines.indexOf(command);
    assert.ok(commandIndex > previousCommandIndex, `${path}: missing or out-of-order ${command}`);
    previousCommandIndex = commandIndex;
  }
}
