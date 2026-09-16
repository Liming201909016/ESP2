import assert from "node:assert/strict";

const repositoryPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

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
    const documentation = readRepositoryFile(entry.documentation);
    for (const term of entry.sourceTerms) {
      assert.ok(source.includes(term), `${entry.id}: source behavior drifted: ${term}`);
    }
    for (const term of entry.documentationTerms) {
      assert.ok(documentation.includes(term), `${entry.id}: documentation drifted: ${term}`);
    }
  }
}
