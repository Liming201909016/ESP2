import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { enterpriseRecords, filterEnterpriseRecords } from "../lib/esp/enterprise-records";
import { EnterpriseRecordLibrary } from "./enterprise-records";
import { LocaleProvider } from "./locale-provider";
import { demoOriginalLabel, demoRecordTypes, demoText } from "../lib/esp/demo-locale";

describe("enterprise record inspection", () => {
  it.each(["en-US", "zh-CN"] as const)("renders actual line items and state without performing an action in %s", (locale) => {
    const onQuery = vi.fn(); const onPrepare = vi.fn();
    const before = JSON.stringify(enterpriseRecords);
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><EnterpriseRecordLibrary onQuery={onQuery} onPrepare={onPrepare} onOpenRecords={() => undefined} pending={false} /></LocaleProvider>);
    expect(html).toContain("SIM-EXP-202609-0018"); expect(html).toContain("1970.00 元"); expect(html).toContain("1730.00 元");
    expect(html).toContain(demoOriginalLabel(locale, "超标例外核查")); expect(html).toContain(demoText(locale, "synthetic"));
    expect(html.match(/class="enterprise-select"/g)).toHaveLength(8);
    expect(html).toContain(demoText(locale, "pagination"));
    expect(html).toContain('value="expense" selected=""');
    for (const record of enterpriseRecords) {
      expect(demoRecordTypes[record.kind]).toBeDefined();
      expect(demoOriginalLabel("en-US", record.statusLabel)).not.toMatch(/[\u4e00-\u9fff]/);
    }
    expect(JSON.stringify(enterpriseRecords)).toBe(before);
    expect(onQuery).not.toHaveBeenCalled(); expect(onPrepare).not.toHaveBeenCalled();
  });
  it("filters by linked records, domain, type and status", () => {
    expect(filterEnterpriseRecords({ query: "SIM-EMP-1003", category: "all", kind: "all", status: "all" }).length).toBeGreaterThan(3);
    expect(filterEnterpriseRecords({ query: "", category: "finance", kind: "expense", status: "returned" }).map((record) => record.id)).toEqual(["SIM-EXP-202609-0011", "SIM-EXP-202609-0027"]);
    expect(filterEnterpriseRecords({ query: "missing-record", category: "all", kind: "all", status: "all" })).toEqual([]);
    expect(enterpriseRecords.filter((record) => record.action)).toHaveLength(6);
    for (const record of enterpriseRecords.filter((item) => item.action)) expect(record.action?.parameters.description).toBe(record.action?.query);
  });
});