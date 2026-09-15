import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import { LocaleProvider } from "./locale-provider";
import { AuditLedgerView } from "./audit-ledger";
import { auditErrorKey, auditMessages, auditText } from "../lib/esp/audit-locale";
import { auditKindSchema, auditOutcomeSchema, auditReferenceSchema } from "../lib/esp/audit-contracts";

const receipt: AuditReceipt = {
  id: `aud-8210900000000-${"a".repeat(32)}`, requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", traceId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb", status: "recorded",
};

describe("audit client feedback", () => {
  it("covers audit contract labels and keeps incomplete outcomes distinct from failure", () => {
    for (const code of [...auditKindSchema.options, ...auditOutcomeSchema.shape.status.options, ...auditReferenceSchema.shape.type.options]) {
      expect(auditMessages[code].every((label) => label.trim().length > 0)).toBe(true);
    }
    expect(auditText("en-US", "incompleteNotice")).toContain("does not mean the business operation failed");
    for (const code of [null, {}, "PRIVATE_ERROR", "__proto__"]) expect(auditErrorKey(code)).toBe("errorUnavailable");
    expect(auditErrorKey("PERMISSION_REQUIRED")).toBe("errorAccess");
    expect(auditErrorKey("NOT_FOUND")).toBe("errorNotFound");
    expect(auditErrorKey("INVALID_REQUEST")).toBe("errorFilter");
  });
  it.each(["en-US", "zh-CN"] as const)("renders audit loading with stable filter codes in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><AuditLedgerView selectedId={null} onSelect={() => undefined} onReference={() => undefined} /></LocaleProvider>);
    expect(html).toContain(auditText(locale, "loading"));
    expect(html).toContain(auditText(locale, "metadataOnly"));
    expect(html).not.toContain(auditText(locale, "empty"));
    expect(html).toContain('value="incomplete"');
    expect(html).toContain('value="connector_sync"');
  });
  it("only continues chains with an acknowledged durable start", () => {
    expect(auditParentHeaders(receipt)).toEqual({ "x-esp-parent-audit-id": receipt.id });
    expect(auditParentHeaders({ ...receipt, status: "incomplete" })).toEqual({ "x-esp-parent-audit-id": receipt.id });
    expect(auditParentHeaders({ ...receipt, status: "unavailable" })).toEqual({});
    expect(auditParentHeaders({ ...receipt, status: "not_recorded", id: null })).toEqual({});
  });
  it("tolerates old responses while rejecting invalid audit metadata", () => {
    expect(readAuditReceipt({ audit: receipt })).toEqual(receipt);
    expect(readAuditReceipt({ ticket: {} })).toBeNull();
    expect(readAuditReceipt({ audit: { ...receipt, id: "javascript:invalid" } })).toBeNull();
  });
  it("renders an incomplete audit notice without calling the business operation failed", () => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="zh-CN"><AuditFeedback receipt={{ ...receipt, status: "incomplete" }} onOpen={() => undefined} /></LocaleProvider>);
    expect(html).toContain("审计收尾未保存，业务结果不变。"); expect(html).toContain("查看审计"); expect(html).not.toContain("业务失败");
  });
  it("does not link to an unconfirmed start record", () => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="zh-CN"><AuditFeedback receipt={{ ...receipt, status: "unavailable" }} onOpen={() => undefined} /></LocaleProvider>);
    expect(html).toContain("审计开始记录未确认。"); expect(html).not.toContain("查看审计");
  });
  it.each([
    ["recorded", "Audit recorded", true],
    ["incomplete", "Audit finalization was not saved; the business result is unchanged.", true],
    ["unavailable", "The audit start record is unconfirmed.", false],
    ["not_recorded", "No persistent audit was recorded for this request.", false],
  ] as const)("renders English %s without changing receipt semantics", (status, message, linkable) => {
    const html = renderToStaticMarkup(<LocaleProvider><AuditFeedback receipt={{ ...receipt, status }} onOpen={() => undefined} /></LocaleProvider>);
    expect(html).toContain(message);
    expect(html.includes("View audit")).toBe(linkable);
  });
});