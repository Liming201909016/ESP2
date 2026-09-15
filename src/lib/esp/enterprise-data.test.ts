import { describe, expect, it } from "vitest";
import { z } from "zod";
import rawData from "../../data/enterprise-data.json";
import { enterpriseData, enterpriseDataSchema, yuan } from "./enterprise-data";
import { buildEnterprisePack } from "../../../scripts/generate-enterprise-data.mjs";
import policies from "../../data/knowledge-samples.json";
import { enterpriseRecordSchema } from "./enterprise-records";
import { knowledgeDocumentSchema } from "./knowledge-corpus";

describe("linked synthetic enterprise data", () => {
  it("validates all source records and preserves established business identities", () => {
    expect(enterpriseData.simulated).toBe(true);
    expect(enterpriseData.employees).toHaveLength(16);
    expect(enterpriseData.departments).toHaveLength(8);
    expect(enterpriseData.expenses).toHaveLength(8);
    expect(enterpriseData.serviceRequests.map((request) => request.impact)).toEqual(expect.arrayContaining(["individual", "team", "organization"]));
    expect(enterpriseData.expenses.find((expense) => expense.id === "SIM-EXP-202609-0007")?.grossCents).toBe(208_000);
    expect(enterpriseData.employees.find((employee) => employee.id === "SIM-EMP-1002")?.leave.available).toBe(5);
  });
  it.each([
    ["missing employee", (data: typeof rawData) => { data.expenses[0].employeeId = "SIM-EMP-9999"; }],
    ["duplicate identifier", (data: typeof rawData) => { data.assets[0].id = data.employees[0].id; }],
    ["wrong line amount", (data: typeof rawData) => { data.expenses[0].lines[0].amountCents += 1; }],
    ["wrong total", (data: typeof rawData) => { data.expenses[0].grossCents += 1; }],
    ["wrong leave balance", (data: typeof rawData) => { data.employees[0].leave.available += 0.5; }],
    ["wrong tenure band with balanced amounts", (data: typeof rawData) => { data.employees[0].leave.entitlement = 20; data.employees[0].leave.available = 14; }],
    ["premature anniversary benefit", (data: typeof rawData) => { data.employees[0].joinedAt = "2021-09-12"; }],
    ["wrong license count", (data: typeof rawData) => { data.software[0].available = 9; }],
    ["wrong project cost center", (data: typeof rawData) => { data.expenses[0].costCenterId = "CC-RD-210"; }],
    ["unapproved supplier order", (data: typeof rawData) => { data.purchases[4].status = "ordered"; data.purchases[4].orderId = "SIM-PO-202609-9999"; }],
    ["impossible timeline", (data: typeof rawData) => { data.securityCases[0].respondedAt = "2026-09-09T01:00:00Z"; }],
    ["real email domain", (data: typeof rawData) => { data.employees[0].email = "person@company.com"; }],
  ])("rejects %s instead of shipping contradictory data", (_label, mutate) => {
    const changed = structuredClone(rawData); mutate(changed);
    expect(enterpriseDataSchema.safeParse(changed).success).toBe(false);
  });
  it("retains failure and incomplete workflows instead of marking every record successful", () => {
    expect(new Set(enterpriseData.expenses.map((expense) => expense.status)).size).toBe(7);
    expect(enterpriseData.purchases.some((purchase) => purchase.status === "blocked" && !purchase.orderId)).toBe(true);
    expect(enterpriseData.softwareRequests.some((request) => request.status === "license_wait")).toBe(true);
    expect(yuan(5220000)).toBe("52,200.00");
  });
  it("projects records into bounded, uniquely cited snapshots without dangling links", () => {
    const pack = z.object({ records: z.array(enterpriseRecordSchema), documents: z.array(knowledgeDocumentSchema) }).parse(buildEnterprisePack(enterpriseData, policies));
    expect(pack.records).toHaveLength(80); expect(pack.documents).toHaveLength(101);
    const identifiers = new Set(pack.records.map((record) => record.id));
    expect(new Set(pack.documents.map((document) => document.id)).size).toBe(101);
    expect(new Set(pack.documents.map((document) => document.documentNumber)).size).toBe(101);
    for (const record of pack.records) {
      expect(record.relatedIds.every((id) => identifiers.has(id))).toBe(true);
      const document = pack.documents.find((entry) => entry.id === record.sourceId)!;
      expect(document.content).toContain(record.id); expect(document.content.length).toBeLessThanOrEqual(4000);
      expect(document.content).toContain("【模拟数据】");
    }
    expect(pack.documents.find((document) => document.id === "dev-procurement-snapshot")?.content).toContain("云岫制造客户门户二期");
    expect(pack.documents.find((document) => document.id === "dev-exp-202609-0018")?.content).toContain("暂核或批准金额：1730.00 元");
  });
});