import assert from "node:assert/strict";

const requiredValidationCommands = [
  "npm run data:check",
  "npm run docs:check",
  "npm run agent-findings:check",
  "npm test",
  "npm run lint",
  "npm run format:check",
  "npm run build",
  "npm run test:e2e",
];

export function validateArchitectureValidationSequence(content) {
  let previousCommandIndex = -1;
  for (const command of requiredValidationCommands) {
    const commandIndex = content.indexOf(command);
    assert.ok(commandIndex > previousCommandIndex, `docs/architecture.md: missing or out-of-order ${command}`);
    previousCommandIndex = commandIndex;
  }
}
