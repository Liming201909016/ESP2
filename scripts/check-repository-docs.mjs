import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { validateArchitectureValidationSequence } from "./repository-docs-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const artifactRoot = resolve(root, "artifacts");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const architecture = readFileSync(resolve(root, "docs", "architecture.md"), "utf8");
validateArchitectureValidationSequence(architecture);
assert.match(
  readFileSync(resolve(root, ".gitignore"), "utf8"),
  /^\/artifacts\/$/m,
  "Local evidence artifacts must remain ignored",
);
const markdownFiles = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "HACKATHON-BACKLOG.md",
  "HACKATHON-DEMO.md",
  "README.md",
  "SECURITY.md",
  "scripts/AGENTS.md",
  "src/lib/esp/AGENTS.md",
];

function collectMarkdown(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectMarkdown(path) : extname(entry.name) === ".md" ? [path] : [];
  });
}

for (const path of collectMarkdown(resolve(root, "docs"))) {
  markdownFiles.push(path.slice(root.length + 1).replaceAll("\\", "/"));
}

for (const path of collectMarkdown(resolve(root, ".github/agents"))) {
  markdownFiles.push(path.slice(root.length + 1).replaceAll("\\", "/"));
}

const checkedLinks = [];
const localEvidenceLinks = [];
const checkedScripts = [];

for (const file of markdownFiles) {
  const absoluteFile = resolve(root, file);
  assert.ok(existsSync(absoluteFile) && statSync(absoluteFile).isFile(), `Missing documentation file: ${file}`);
  const content = readFileSync(absoluteFile, "utf8");

  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const resolvedTarget = resolve(dirname(absoluteFile), decodeURIComponent(target));
    const artifactPath = relative(artifactRoot, resolvedTarget);
    if (artifactPath === "" || (!artifactPath.startsWith("..") && !/^(?:[A-Za-z]:)?[\\/]/.test(artifactPath))) {
      localEvidenceLinks.push(`${file}:${target}`);
      continue;
    }
    assert.ok(existsSync(resolvedTarget), `${file}: missing link target ${target}`);
    checkedLinks.push(`${file}:${target}`);
  }

  for (const match of content.matchAll(/\bnpm run ([a-z\d:_-]+)/gi)) {
    const script = match[1];
    assert.ok(packageJson.scripts?.[script], `${file}: unknown npm script ${script}`);
    checkedScripts.push(`${file}:${script}`);
  }
}

console.log(
  `documentation: ${markdownFiles.length} files, ${checkedLinks.length} repository links, ${localEvidenceLinks.length} local evidence links, ${checkedScripts.length} npm commands valid`,
);
