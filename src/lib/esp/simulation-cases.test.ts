import { describe, expect, it } from "vitest";
import { knowledgeDocuments } from "./knowledge-corpus";
import { simulationCases } from "./simulation-cases";
import { routeSkill } from "./router";

describe("formal simulation cases", () => {
  it("provides unique cases and explicit expected outcomes", () => {
    expect(simulationCases).toHaveLength(46);
    expect(new Set(simulationCases.map((testCase) => testCase.id)).size).toBe(46);
    expect(simulationCases.filter((testCase) => testCase.expected === "no_evidence")).toHaveLength(2);
  });

  it.each(simulationCases)("routes $id to its expected scenario and references existing evidence", (testCase) => {
    const route = routeSkill(testCase.query, ["knowledge.read"]);
    expect(route.status).toBe("matched");
    if (route.status !== "matched") throw new Error("Expected a matched scenario");
    expect(route.skill.id).toBe(testCase.skillId);
    for (const sourceId of [testCase.source, ...(testCase.alternateSources ?? [])].filter(Boolean)) {
      const source = knowledgeDocuments.find((document) => document.id === sourceId);
      expect(source?.skillId).toBe(testCase.skillId);
    }
    if (testCase.expected === "answer") expect(testCase.facts.length).toBeGreaterThan(0);
  });

  it("keeps financial examples arithmetically consistent", () => {
    const mealCase = simulationCases.find((testCase) => testCase.id === "SIM-QA-011");
    expect(mealCase?.facts.at(-1)?.anyOf).toContain(String(120 - 50));
    const travel = knowledgeDocuments.find((document) => document.id === "dev-travel-approval");
    expect(travel?.content).toContain("120元/人/完整出差日");
    expect(travel?.content).toContain("午餐50元");
    const expense = knowledgeDocuments.find((document) => document.id === "dev-expense-snapshot");
    expect(expense?.content).toContain(`总额${2 * 580 + 680 + 2 * 120}元`);
    const purchase = knowledgeDocuments.find((document) => document.id === "dev-procurement-snapshot");
    expect(purchase?.content).toContain(`总额${10 * 800}元`);
  });

  it("allows only the two reviewed equivalent software sources with the same requested facts", () => {
    const equivalents = simulationCases.filter((testCase) => testCase.alternateSources?.length);
    expect(equivalents.map((testCase) => testCase.id)).toEqual(["SIM-QA-021", "SIM-QA-022"]);
    for (const testCase of equivalents) for (const sourceId of [testCase.source, ...testCase.alternateSources!]) {
      const source = knowledgeDocuments.find((document) => document.id === sourceId)!;
      const text = source.content.normalize("NFKC").replace(/[\s,，*]/gu, "").toLowerCase();
      for (const fact of testCase.facts) expect(fact.anyOf.some((value) => text.includes(value.normalize("NFKC").replace(/[\s,，*]/gu, "").toLowerCase()))).toBe(true);
    }
  });
});