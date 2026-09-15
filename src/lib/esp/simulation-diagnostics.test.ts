import { describe, expect, it, vi } from "vitest";
import { diagnoseSimulation } from "./simulation-diagnostics";
import { knowledgeDocuments } from "./knowledge-corpus";

describe("fixed simulation diagnostics", () => {
  it("rejects arbitrary queries, unknown cases and caller supplied sources before retrieval", async () => {
    const retrieve = vi.fn();
    for (const input of [{ caseId: "SIM-QA-999" }, { caseId: "VPN-001", query: "private" }, { caseId: "VPN-001", sources: [] }]) await expect(diagnoseSimulation(input, { retrieve })).rejects.toThrow();
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("captures a bounded rejected draft from immutable builtin evidence without importing other sources", async () => {
    const source = knowledgeDocuments.find((entry) => entry.id === "dev-software-vpn-support")!;
    const privateSource = { ...source, id: "kb-00000000000000000000000000000000-c001", corpus: "esp-dev-managed-v1" as const, content: "PRIVATE CONTENT" };
    const retrieve = vi.fn().mockResolvedValue([privateSource, source]);
    const generate = vi.fn().mockResolvedValue({ supported: true, answer: "模拟：123456789 个未经证实的状态。", citations: [{ id: source.id, quote: source.content.slice(0, 80) }], calculations: [] });
    const review = vi.fn();
    const report = await diagnoseSimulation({ caseId: "VPN-001" }, { retrieve, generate, review });
    expect(retrieve).toHaveBeenCalledWith("search-software-catalog", expect.any(String), { builtinOnly: true, policyOnly: true });
    expect(report.error).toBe("unsupported_number"); expect(report.candidates).toEqual([{ id: source.id, version: source.version }]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE CONTENT"); expect(review).not.toHaveBeenCalled();
    expect(report.draft).toMatchObject({ supported: true });
  });
  it("does not return provider errors or invalid raw completions", async () => {
    const source = knowledgeDocuments[0];
    const report = await diagnoseSimulation({ caseId: "SIM-QA-001" }, { retrieve: vi.fn().mockResolvedValue([source]), generate: vi.fn().mockRejectedValue(new Error("private token")) });
    expect(report.error).toBe("DIAGNOSTIC_UNAVAILABLE"); expect(JSON.stringify(report)).not.toContain("private token");
  });
});