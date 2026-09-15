import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlobConnectorView, connectorMessage } from "./blob-connector";
import { LocaleProvider } from "./locale-provider";
import { connectorErrorCodes, connectorErrorKey, connectorMessages, connectorText } from "../lib/esp/connector-locale";
import { connectorDetailSchema, connectorRunSchema } from "../lib/esp/connector-contracts";

describe("Blob connector display states", () => {
  it.each(["en-US", "zh-CN"] as const)("renders translated loading and stable filter values in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><BlobConnectorView selectedId={null} onSelect={() => undefined} onOpenDocument={() => undefined} onOpenAudit={() => undefined} /></LocaleProvider>);
    expect(html).toContain(connectorText(locale, "loadingSources"));
    expect(html).toContain(connectorText(locale, "draftTarget"));
    expect(html).not.toContain(connectorText(locale, "noSources"));
    expect(html).not.toContain(connectorText(locale, "syncAction"));
    expect(html).not.toContain(connectorText(locale, "seedAction"));
    for (const change of connectorDetailSchema.shape.change.options) expect(html).toContain(`value="${change}"`);
  });
  it.each(connectorErrorCodes)("translates %s without changing its code", (code) => {
    expect(connectorErrorKey(code)).toBe(code);
    expect(connectorMessage(code, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
    expect(connectorMessage(code, "en-US")).not.toBe(connectorMessage("unknown", "en-US"));
  });
  it("preserves uncertainty, recovery and no-publication meanings", () => {
    for (const pair of Object.values(connectorMessages)) {
      expect(pair.every((value) => value.trim().length > 0)).toBe(true);
      expect(pair[0]).not.toMatch(/[\u4e00-\u9fff]/);
    }
    for (const outcome of connectorRunSchema.shape.outcome.options) expect(connectorText("en-US", outcome)).toBeTruthy();
    for (const code of [null, {}, "toString", "__proto__", "PRIVATE_ERROR"]) expect(connectorErrorKey(code)).toBe("requestFailure");
    expect(connectorMessage("SYNC_DRAFT_UNCONFIRMED", "en-US")).toContain("same target ID");
    expect(connectorMessage("SOURCE_NOT_FOUND", "en-US")).toContain("Imported documents remain unchanged");
    expect(connectorText("en-US", "syncWarning")).toContain("without publishing it automatically");
    expect(connectorText("en-US", "reuseWarning")).toContain("retaining its current publication status");
    expect(connectorText("en-US", "seedWarning")).toContain("Existing files remain unchanged");
  });
  it("renders an initial empty selection without exposing unconfirmed actions", () => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="zh-CN"><BlobConnectorView selectedId={null} onSelect={() => undefined} onOpenDocument={() => undefined} onOpenAudit={() => undefined} /></LocaleProvider>);
    expect(html).toContain("Azure Blob 资料同步"); expect(html).toContain("正在读取来源与差异");
    expect(html).not.toContain("确认同步"); expect(html).not.toContain("确认初始化");
  });
  it("does not render raw error text from unknown dependencies", () => {
    expect(connectorMessage("private server details")).not.toContain("private server details");
    expect(connectorMessage("SYNC_DRAFT_UNCONFIRMED")).toContain("结果未确认");
    expect(connectorMessage("SOURCE_CHANGED")).toContain("刷新");
  });
});