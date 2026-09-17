import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { repositoryMarkdownPaths, validateArchitectureValidationSequence } from "./repository-docs-contract.mjs";
import { documentationLinkTargets } from "./docs-drift-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const artifactRoot = resolve(root, "artifacts");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const path of ["CONTRIBUTING.md", "docs/architecture.md", "docs/specs/esp-engineering-contract-v1.md"]) {
  validateArchitectureValidationSequence(readFileSync(resolve(root, path), "utf8"), path);
}
assert.match(
  readFileSync(resolve(root, ".gitignore"), "utf8"),
  /^\/artifacts\/$/m,
  "Local evidence artifacts must remain ignored",
);
assert.equal(
  readFileSync(resolve(root, "CLAUDE.md"), "utf8").trim(),
  "@AGENTS.md",
  "CLAUDE.md must delegate to AGENTS.md",
);
const markdownFiles = repositoryMarkdownPaths(
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md", "*.mdx"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean),
  (path) => existsSync(resolve(root, path)),
);

const checkedLinks = [];
const localEvidenceLinks = [];
const checkedScripts = [];

for (const file of markdownFiles) {
  const absoluteFile = resolve(root, file);
  assert.ok(existsSync(absoluteFile) && statSync(absoluteFile).isFile(), `Missing documentation file: ${file}`);
  const content = readFileSync(absoluteFile, "utf8");

  for (const link of documentationLinkTargets(content)) {
    const target = link.split("#", 1)[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const decodedTarget = decodeURIComponent(target);
    const resolvedTarget = decodedTarget.startsWith("/")
      ? resolve(root, `.${decodedTarget}`)
      : resolve(dirname(absoluteFile), decodedTarget);
    const repositoryPath = relative(root, resolvedTarget);
    assert.ok(
      repositoryPath !== ".." &&
        !repositoryPath.startsWith(`..\\`) &&
        !repositoryPath.startsWith("../") &&
        !/^(?:[A-Za-z]:)?[\\/]/.test(repositoryPath),
      `${file}: link target escapes repository: ${target}`,
    );
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
