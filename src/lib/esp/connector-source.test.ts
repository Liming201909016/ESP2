import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { connectorDocumentId, connectorPaths, connectorSnapshot, decodeConnectorText, parseConnectorManifest } from "./connector-source";

const content = Buffer.from("# Synthetic policy\r\n\r\nTransit support is 37 test credits.");
const manifest = {
  title: "Synthetic transit rule", skillId: "search-expense-policy", documentNumber: "SIM-FIN-CONNECTOR-001", owner: "Simulation finance",
  effectiveDate: "2026-09-11", dataKind: "policy", filename: "policy.md", simulated: true, contentSha256: createHash("sha256").update(content).digest("hex"),
};
const parsedManifest = () => parseConnectorManifest(Buffer.from(JSON.stringify(manifest)));

describe("Blob knowledge source format", () => {
  it("confines manifest and text paths to the fixed source prefix", () => {
    expect(connectorPaths("sim-transit", "policy.md")).toEqual({ manifest: "connector-sources/knowledge/sim-transit/manifest.json", content: "connector-sources/knowledge/sim-transit/policy.md" });
  });
  it.each(["../tickets", "https://external.example", "folder/source", "source\\name", "%2e%2e"])("rejects unsafe source IDs: %s", (id) => {
    expect(() => connectorPaths(id)).toThrow();
  });
  it.each(["../source.md", "nested/source.txt", "file.pdf", "https://external.example/file.txt"])("rejects nonlocal or unsupported files: %s", (filename) => {
    expect(() => connectorPaths("sim-transit", filename)).toThrow();
  });
  it("verifies raw bytes before applying the existing import normalization", () => {
    const result = connectorSnapshot(parsedManifest(), content);
    expect(result.input.content).toBe("# Synthetic policy\n\nTransit support is 37 test credits.");
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects mixed manifest/content revisions", () => {
    expect(() => connectorSnapshot(parsedManifest(), Buffer.from("Updated content without its manifest"))).toThrow("SOURCE_CONTENT_MISMATCH");
  });
  it("does not accept unlabelled or foreign-format metadata", () => {
    expect(() => parseConnectorManifest(Buffer.from(JSON.stringify({ ...manifest, simulated: false })))).toThrow("INVALID_SOURCE_MANIFEST");
    expect(() => parseConnectorManifest(Buffer.from(JSON.stringify({ ...manifest, endpoint: "https://external.example" })))).toThrow("INVALID_SOURCE_MANIFEST");
  });
  it("bounds files and strictly decodes UTF-8", () => {
    expect(() => decodeConnectorText(new Uint8Array([0xc3, 0x28]), 100)).toThrow("INVALID_SOURCE_UTF8");
    expect(() => decodeConnectorText(new Uint8Array(101), 100)).toThrow("SOURCE_TOO_LARGE");
    expect(() => parseConnectorManifest(Buffer.from("not JSON"))).toThrow("INVALID_SOURCE_MANIFEST");
  });
  it("maps the same source snapshot to one document without sharing IDs across accounts or sources", () => {
    const { fingerprint } = connectorSnapshot(parsedManifest(), content);
    const id = connectorDocumentId("accountone", "sim-transit", fingerprint);
    expect(id).toMatch(/^kb-[a-f0-9]{32}$/);
    expect(connectorDocumentId("accountone", "sim-transit", fingerprint)).toBe(id);
    expect(connectorDocumentId("accounttwo", "sim-transit", fingerprint)).not.toBe(id);
    expect(connectorDocumentId("accountone", "sim-other", fingerprint)).not.toBe(id);
  });
});