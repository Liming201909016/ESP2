import { describe, expect, it, vi } from "vitest";
import { catalogDefinitions, getSkillCatalog } from "./skill-catalog";
import { catalogEntrySchema } from "./catalog-contracts";
import { skillExecutionKind } from "./skill-execution";
import { ticketDetailsSchema } from "./contracts";
import { simulationCases } from "./simulation-cases";
import { knowledgeDocuments } from "./knowledge-corpus";
import { z } from "zod";
import { skillRegistry } from "./registry";
import { routeSkill } from "./router";
import { presentedInputLabel, skillSearchText } from "./skill-presentation";

describe("skill catalog definitions", () => {
  it("returns the current registered versions without changing the registry", () => {
    const before = structuredClone(skillRegistry);
    const definitions = catalogDefinitions(["knowledge.read", "tickets.read", "tickets.create"]);
    expect(definitions).toHaveLength(7);
    expect(definitions).toEqual(before);
    expect(skillRegistry).toEqual(before);
  });

  it("does not expose definitions when there are no permissions", () => {
    expect(catalogDefinitions([])).toEqual([]);
  });

  it("limits knowledge readers to the five knowledge scenarios", () => {
    const definitions = catalogDefinitions(["knowledge.read"]);
    expect(definitions).toHaveLength(5);
    expect(definitions.every((skill) => skill.category === "knowledge")).toBe(true);
  });

  it.each([
    ["tickets.read" as const, "get-ticket-status"],
    ["tickets.create" as const, "create-it-ticket"],
  ])("matches routing eligibility for %s", (permission, skillId) => {
    const definitions = catalogDefinitions([permission]);
    expect(definitions.map((skill) => skill.id)).toEqual([skillId]);
    const route = routeSkill(definitions[0].keywords[0], [permission]);
    expect(route).toMatchObject({ status: "matched", skill: { id: skillId } });
  });

  it("requires every permission for a combined-permission skill", () => {
    const combined = { ...skillRegistry[0], permissions: ["knowledge.read", "tickets.read"] as ("knowledge.read" | "tickets.read")[] };
    expect(catalogDefinitions(["knowledge.read"], [combined])).toEqual([]);
    expect(catalogDefinitions(["knowledge.read", "tickets.read"], [combined])).toEqual([combined]);
  });
});

describe("executable catalog metadata", () => {
  const permissions = ["knowledge.read", "tickets.read", "tickets.create"] as const;
  it("searches English and original names without a locale-dependent result set", () => {
    const catalog = getSkillCatalog([...permissions]);
    const before = JSON.stringify(catalog);
    for (const query of ["HR Policy Lookup", "人事制度查询", "search-company-policy"]) {
      expect(catalog.filter((entry) => skillSearchText(entry).includes(query.toLowerCase())).map((entry) => entry.id)).toEqual(["search-company-policy"]);
    }
    expect(catalog.filter((entry) => skillSearchText(entry).includes("tickets.create")).map((entry) => entry.id)).toEqual(["create-it-ticket"]);
    expect(JSON.stringify(catalog)).toBe(before);
  });
  it("localizes known input labels while preserving schema, option codes and unknown metadata", () => {
    const catalog = getSkillCatalog([...permissions]);
    const before = JSON.stringify(catalog);
    for (const input of catalog.flatMap((entry) => entry.inputs)) {
      expect(presentedInputLabel(input, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
      expect(presentedInputLabel(input, "zh-CN")).toBe(input.label);
    }
    expect(presentedInputLabel({ name: "impact", label: "Changed meaning" }, "en-US")).toBe("Changed meaning");
    expect(presentedInputLabel({ name: "toString", label: "Unknown field" }, "en-US")).toBe("Unknown field");
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("identifies distinct finance and enterprise knowledge bases from runtime binding", () => {
    vi.stubEnv("ESP_FINANCE_KNOWLEDGE_ENABLED", "true");
    try {
      const entries = getSkillCatalog([...permissions]);
      expect(entries.find((entry) => entry.id === "search-expense-policy")?.knowledgeBase).toEqual({ id: "finance", name: "财务差旅知识库", indexName: "esp-finance-dev-v1" });
      expect(entries.find((entry) => entry.id === "search-company-policy")?.knowledgeBase?.indexName).toBe("esp-knowledge-dev-v1");
      expect(entries.find((entry) => entry.id === "get-ticket-status")?.knowledgeBase).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });

  it("serializes to the public catalog contract and reflects actual dispatch", () => {
    const catalog = getSkillCatalog([...permissions]);
    for (const entry of catalog) {
      expect(catalogEntrySchema.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
      expect(entry.implementation).toBe(skillExecutionKind(entry.id));
      expect(entry.implementation).not.toBe("unavailable");
    }
  });

  it("derives ticket input constraints from the executor's schema", () => {
    const entry = getSkillCatalog(["tickets.create"])[0];
    expect(entry.inputLocation).toBe("parameters");
    expect(entry.inputSchema).toEqual(z.toJSONSchema(ticketDetailsSchema));
    expect(entry.inputs.filter((input) => input.required).map((input) => input.name)).toEqual(["description", "impact"]);
    expect(entry.inputs.find((input) => input.name === "device")).toMatchObject({ required: false, maxLength: 120 });
    expect(entry.inputs.find((input) => input.name === "impact")?.options).toEqual(["individual", "team", "organization"]);
    expect(entry.confirmationRequired).toBe(true);
  });

  it("binds review-only evaluation profiles to all seven visible skill versions", () => {
    const entries = getSkillCatalog([...permissions]);
    expect(entries).toHaveLength(7);
    for (const entry of entries) {
      expect(entry.evaluation).toMatchObject({
        skillId: entry.id, skillVersion: entry.version, version: "1.0.0", ownerAssignment: "unassigned",
        minimumCases: 20, thresholdStatus: "provisional", automaticPromotion: false,
      });
      expect(entry.evaluation?.hardGates.length).toBeGreaterThan(0);
      expect(entry.evaluation).not.toHaveProperty("score");
      expect(entry.evaluation).not.toHaveProperty("passed");
    }
    expect(entries.find((entry) => entry.id === "create-it-ticket")?.evaluation?.hardGates).toContain("idempotent_effect");
    expect(entries.find((entry) => entry.id === "get-ticket-status")?.evaluation?.hardGates).toContain("owner_scope");
  });

  it("keeps all simulation cases and sources associated with their owning skills", () => {
    const catalog = getSkillCatalog(["knowledge.read"]);
    expect(catalog.flatMap((entry) => entry.examples)).toHaveLength(simulationCases.length);
    expect(catalog.flatMap((entry) => entry.sources)).toHaveLength(knowledgeDocuments.length);
    for (const entry of catalog) {
      for (const example of entry.examples) {
        expect(simulationCases.find((testCase) => testCase.id === example.caseId)?.skillId).toBe(entry.id);
      }
      for (const source of entry.sources) {
        expect(knowledgeDocuments.find((document) => document.id === source.id)?.skillId).toBe(entry.id);
        expect(source.url).toBe(`/knowledge/${source.id}`);
        expect(source).not.toHaveProperty("content");
      }
    }
  });

  it("shows required ticket ID input without creating fake records", () => {
    const entry = getSkillCatalog(["tickets.read"])[0];
    expect(entry.inputs).toEqual([expect.objectContaining({ name: "ticketId", required: true, pattern: "^ESP-\\d{8}-[A-F0-9]{8}$" })]);
    expect(entry.examples[0].query).toBe("查询工单状态");
    expect(entry.sources).toEqual([]);
  });

  it("marks an unimplemented registry entry explicitly unavailable", () => {
    const unsupported = { ...skillRegistry[0], id: "future-skill" };
    const entry = getSkillCatalog(["knowledge.read"], [unsupported])[0];
    expect(entry.implementation).toBe("unavailable");
    expect(entry.resultTypes).toEqual(["unavailable"]);
    expect(entry.inputs).toEqual([]);
    expect(entry.examples).toEqual([]);
    expect(entry.sources).toEqual([]);
    expect(entry.evaluation).toBeNull();
  });
});