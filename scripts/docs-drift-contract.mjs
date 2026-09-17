import assert from "node:assert/strict";
import { parsers } from "prettier/plugins/markdown";

const repositoryPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

export function documentationLinkTargets(content) {
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(parsers.remark.parse(content));
  const definitions = new Map(
    nodes.filter((node) => node.type === "definition").map((node) => [node.identifier, node.url]),
  );
  return nodes.flatMap((node) => {
    if (node.type === "link" || node.type === "image") return [node.url];
    if (node.type === "linkReference" || node.type === "imageReference") {
      assert.ok(definitions.has(node.identifier), `Missing Markdown definition: ${node.identifier}`);
      return [definitions.get(node.identifier)];
    }
    return [];
  });
}

function documentationSection(content, heading, nodes) {
  assert.equal(typeof heading, "string", "documentationHeading must be a string");
  assert.ok(heading.trim(), "documentationHeading must not be empty");
  function text(node) {
    return node.value ?? (node.children ?? []).map(text).join("");
  }
  const matching = nodes.filter((node) => node.type === "heading" && text(node) === heading);
  assert.equal(matching.length, 1, `documentationHeading must identify one section: ${heading}`);
  const selected = matching[0];
  const next = nodes
    .slice(nodes.indexOf(selected) + 1)
    .find((node) => node.type === "heading" && node.depth <= selected.depth);
  return content.slice(selected.position.end.offset, next?.position.start.offset ?? content.length);
}

export function validateDocsDriftContract(contract, readRepositoryFile) {
  assert.equal(contract.schemaVersion, 1, "docs drift contract schemaVersion must be 1");
  assert.ok(Array.isArray(contract.contracts) && contract.contracts.length > 0, "docs drift contracts are required");

  const ids = new Set();
  for (const entry of contract.contracts) {
    assert.match(entry.id, /^[a-z0-9-]+$/u, "docs drift contract id is invalid");
    assert.ok(!ids.has(entry.id), `duplicate docs drift contract id: ${entry.id}`);
    ids.add(entry.id);
    assert.match(entry.source, repositoryPathPattern, `${entry.id}: invalid source path`);
    assert.match(entry.documentation, repositoryPathPattern, `${entry.id}: invalid documentation path`);
    const source = readRepositoryFile(entry.source);
    for (const term of entry.sourceTerms) {
      assert.ok(source.includes(term), `${entry.id}: source behavior drifted: ${term}`);
    }
  }

  const documents = new Map();
  for (const entry of contract.contracts) {
    if (!documents.has(entry.documentation)) {
      documents.set(entry.documentation, { content: readRepositoryFile(entry.documentation), nodes: null });
    }
    const document = documents.get(entry.documentation);
    if (entry.documentationHeading !== undefined && document.nodes === null) {
      document.nodes = parsers.remark.parse(document.content).children;
    }
    const documentation =
      entry.documentationHeading === undefined
        ? document.content
        : documentationSection(document.content, entry.documentationHeading, document.nodes);
    for (const term of entry.documentationTerms) {
      assert.ok(documentation.includes(term), `${entry.id}: documentation drifted: ${term}`);
    }
    for (const term of entry.forbiddenDocumentationTerms ?? []) {
      assert.ok(!documentation.includes(term), `${entry.id}: obsolete documentation claim: ${term}`);
    }
  }
}
