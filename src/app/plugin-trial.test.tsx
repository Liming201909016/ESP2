import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PluginTrialPanel, SavedTicketPicker, savedTicketChoices } from "./plugin-trial";
import { LocaleProvider } from "./locale-provider";
import { PluginCatalogView } from "./plugin-catalog";
import { getPluginCatalog } from "../lib/esp/plugin-catalog";
import { pluginErrorKey, pluginMessages, pluginText } from "../lib/esp/plugin-locale";
import { pluginTrialResponseSchema } from "../lib/esp/plugin-contracts";

describe("Plugin localization", () => {
  it.each(["en-US", "zh-CN"] as const)("renders loading filters without claiming an empty catalog in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><PluginCatalogView selectedId={null} onSelect={vi.fn()} onReview={vi.fn()} executionPending={false} /></LocaleProvider>);
    expect(html).toContain(pluginText(locale, "catalogLoading"));
    expect(html).toContain(pluginText(locale, "allOperations"));
    expect(html).toContain(pluginText(locale, "allConfigs"));
    expect(html).not.toContain(pluginText(locale, "noPlugins"));
    expect(html).toContain('value="write"');
  });
  it.each(["en-US", "zh-CN"] as const)("preserves original trial inputs and disabled state in %s", (locale) => {
    const plugins = getPluginCatalog(["knowledge.read", "tickets.read", "tickets.create"], {});
    const before = JSON.stringify(plugins);
    const onReview = vi.fn();
    for (const plugin of plugins) for (const operation of plugin.operations) {
      const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><PluginTrialPanel plugin={plugin} operation={operation} disabled={true} onReview={onReview} executionPending={false} /></LocaleProvider>);
      expect(html).toContain(pluginText(locale, "noResult"));
      expect(html).toContain(pluginText(locale, operation.effect === "write" ? "generate" : "runRead"));
      expect(html).toContain('fieldset disabled=""');
      expect(html).toContain(`value="${operation.skills[0].id}"`);
      if (operation.id === "tickets.create") expect(html).toContain('value="individual"');
      if (operation.id === "tickets.get") expect(html).toContain(pluginText(locale, "savedLoad"));
    }
    expect(onReview).not.toHaveBeenCalled();
    expect(JSON.stringify(plugins)).toBe(before);
  });
  it("covers trial statuses and never treats configuration as verified connectivity", () => {
    for (const pair of Object.values(pluginMessages)) {
      expect(pair.every((value) => value.trim().length > 0)).toBe(true);
      expect(pair[0]).not.toMatch(/[\u4e00-\u9fff]/);
    }
    for (const status of pluginTrialResponseSchema.shape.status.options) expect(pluginText("en-US", `status_${status}`)).toBeTruthy();
    expect(pluginText("en-US", "notProbed")).toBe("Not probed");
    expect(pluginText("en-US", "noWrite")).toBe("No write executed");
    expect(pluginText("en-US", "cancelled")).toContain("may still be running");
  });
  it("allowlists public errors without exposing unknown or inherited keys", () => {
    for (const code of ["AUTHENTICATION_REQUIRED", "PERMISSION_REQUIRED", "SUBJECT_REQUIRED", "OPERATION_SKILL_MISMATCH", "PLUGIN_OPERATION_NOT_FOUND", "INVALID_REQUEST", "REQUEST_TOO_LARGE"]) expect(pluginErrorKey(code)).toBe(code);
    for (const code of ["PRIVATE_BODY", "__proto__", "toString", null, {}]) expect(pluginErrorKey(code)).toBe("trialFailure");
  });
});

describe("actual DEV ticket choices", () => {
  const receipt = { id: "ESP-20260911-A1B2C3D4", status: "open", summary: "SIM-LT-0042 VPN connection issue", createdAt: "2026-09-11T00:00:00Z", createdBy: "development:local" };
  it("keeps real receipt IDs and rejects reference-only service records", () => {
    expect(savedTicketChoices({ tickets: [receipt] })).toEqual([receipt]);
    expect(() => savedTicketChoices({ tickets: [{ ...receipt, id: "SIM-SR-202609-0108" }] })).toThrow();
    expect(() => savedTicketChoices({ error: "TICKET_LIST_FAILED" })).toThrow();
    expect(savedTicketChoices({ tickets: [] })).toEqual([]);
  });
  it("does not select or fetch a record merely by rendering the picker", () => {
    const onChoose = vi.fn();
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="zh-CN"><SavedTicketPicker value="" disabled={false} onChoose={onChoose} /></LocaleProvider>);
    expect(html).toContain("读取已保存工单"); expect(html).not.toContain("ESP-2026");
    expect(onChoose).not.toHaveBeenCalled();
  });
});