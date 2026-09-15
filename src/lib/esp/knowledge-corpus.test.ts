import { describe, expect, it } from "vitest";
import { knowledgeDocuments, knowledgeSkillIds, knowledgeDataVersion } from "./knowledge-corpus";

describe("DEV knowledge corpus", () => {
  it("contains uniquely addressable, explicitly labelled DEV samples", () => {
    expect(knowledgeDocuments).toHaveLength(101);
    expect(new Set(knowledgeDocuments.map((document) => document.id)).size).toBe(101);
    expect(new Set(knowledgeDocuments.map((document) => document.documentNumber)).size).toBe(101);
    for (const document of knowledgeDocuments) {
      expect(document.title).toContain("模拟");
      expect(document.content).toContain("【模拟数据】");
      expect(document.organization).toBe("澄川数科（虚构组织）");
      expect(document.version).toBe(knowledgeDataVersion);
      expect(document.effectiveDate).toBe(document.dataKind === "policy" ? "2026-09-01" : "2026-09-11");
      expect(document.owner).toBeTruthy();
    }
  });

  it.each(knowledgeSkillIds)("provides policy and transaction evidence for %s", (skillId) => {
    const documents = knowledgeDocuments.filter((document) => document.skillId === skillId);
    expect(documents.filter((document) => document.dataKind === "policy").length).toBeGreaterThanOrEqual(3);
    expect(documents.some((document) => document.dataKind === "snapshot")).toBe(true);
  });

  it.each([
    ["dev-hr-leave", "满5年未满10年为15个工作日"],
    ["dev-travel-approval", "600元/人/晚"],
    ["dev-procurement-request", "超过5000元且不超过50000元"],
    ["dev-expense-snapshot", "总额2080元"],
    ["dev-software-licenses", "已分配32席，可用8席"],
  ])("preserves the reference fact in %s", (sourceId, fact) => {
    expect(knowledgeDocuments.find((document) => document.id === sourceId)?.content).toContain(fact);
  });

  it("identifies static business snapshots separately from policies", () => {
    expect(knowledgeDocuments.filter((document) => document.dataKind === "snapshot")).toHaveLength(84);
    expect(knowledgeDocuments.filter((document) => document.dataKind === "policy")).toHaveLength(17);
    for (const document of knowledgeDocuments.filter((document) => document.dataKind === "snapshot")) {
      expect(document.content).toContain("2026-09-11");
    }
  });

  it("provides explicit simulated VPN support coverage without asserting a diagnosis or completed action", () => {
    const source = knowledgeDocuments.find((document) => document.id === "dev-software-vpn-support")!;
    expect(source).toMatchObject({ skillId: "search-software-catalog", dataKind: "policy", documentNumber: "SIM-IT-005", version: "2026.09-sim-v4" });
    for (const text of ["受理要素", "设备与软件核对", "后续处理与必要审批", "恢复确认", "不得仅凭错误码认定根因", "不得关闭防火墙", "不自动分派、修复或关闭工单"]) expect(source.content).toContain(text);
  });
});