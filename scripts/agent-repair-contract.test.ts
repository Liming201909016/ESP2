import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeAgentRepair, prepareAgentRepair, validateAgentRepairEvents } from "./agent-repair-contract.mjs";

const temporaryRoots: string[] = [];
const successfulEvents = `${JSON.stringify({ type: "tool.execution_start", data: { toolName: "edit" } })}\n${JSON.stringify({ type: "result", exitCode: 0 })}\n`;

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function repository() {
  const root = mkdtempSync(resolve(tmpdir(), "esp-agent-repair-"));
  temporaryRoots.push(root);
  git(root, "init");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.name", "Synthetic Test");
  git(root, "config", "user.email", "synthetic@example.invalid");
  writeFileSync(resolve(root, "allowed.txt"), "before\n");
  writeFileSync(resolve(root, "outside.txt"), "before\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "synthetic baseline");
  return { root, targetSha: git(root, "rev-parse", "HEAD") };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agent repair proposal contract", () => {
  it("emits a digest-bound patch for allowlisted changes", () => {
    const { root, targetSha } = repository();
    const contextDirectory = resolve(root, "..", `${targetSha}-context`);
    const outputDirectory = resolve(root, "..", `${targetSha}-output`);
    temporaryRoots.push(contextDirectory, outputDirectory);
    const context = prepareAgentRepair({
      targetRoot: root,
      outputDirectory: contextDirectory,
      repository: "synthetic/repository",
      targetSha,
      task: "Update the synthetic allowed file only.",
      allowedPaths: "allowed.txt",
    });
    writeFileSync(resolve(root, "allowed.txt"), "after\n");

    const manifest = finalizeAgentRepair({
      targetRoot: root,
      context,
      outputDirectory,
      workflowRunId: "12345",
      model: "synthetic-model",
      copilotCliVersion: "1.0.83",
      eventStream: successfulEvents,
    });

    expect(manifest.changedPaths).toEqual(["allowed.txt"]);
    expect(manifest.humanReviewRequired).toBe(true);
    expect(readFileSync(resolve(outputDirectory, "repair.patch"), "utf8")).toContain("+after");
  });

  it("rejects a change outside the explicit allowlist", () => {
    const { root, targetSha } = repository();
    const contextDirectory = resolve(root, "..", `${targetSha}-context`);
    const outputDirectory = resolve(root, "..", `${targetSha}-output`);
    temporaryRoots.push(contextDirectory, outputDirectory);
    const context = prepareAgentRepair({
      targetRoot: root,
      outputDirectory: contextDirectory,
      repository: "synthetic/repository",
      targetSha,
      task: "Update the synthetic allowed file only.",
      allowedPaths: "allowed.txt",
    });
    writeFileSync(resolve(root, "outside.txt"), "after\n");
    mkdirSync(outputDirectory, { recursive: true });

    expect(() =>
      finalizeAgentRepair({
        targetRoot: root,
        context,
        outputDirectory,
        workflowRunId: "12345",
        model: "synthetic-model",
        copilotCliVersion: "1.0.83",
        eventStream: successfulEvents,
      }),
    ).toThrow("outside allowlist");
  });

  it("rejects tools outside the repair allowlist", () => {
    const events = `${JSON.stringify({ type: "tool.execution_start", data: { toolName: "bash" } })}\n${JSON.stringify({ type: "result", exitCode: 0 })}\n`;
    expect(() => validateAgentRepairEvents(events)).toThrow("disallowed repair tool");
  });
});
