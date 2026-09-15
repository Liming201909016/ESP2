"use client";

import { FileClock } from "lucide-react";
import { auditReceiptSchema, type AuditReceipt } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";

export function readAuditReceipt(body: unknown): AuditReceipt | null {
  const value = typeof body === "object" && body !== null && "audit" in body ? body.audit : null;
  const parsed = auditReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function auditParentHeaders(receipt?: AuditReceipt | null): Record<string, string> {
  return receipt?.id && (receipt.status === "recorded" || receipt.status === "incomplete") ? { "x-esp-parent-audit-id": receipt.id } : {};
}

export function AuditFeedback({ receipt, onOpen }: { receipt?: AuditReceipt | null; onOpen?: (id: string) => void }) {
  const { t } = useLocale();
  if (!receipt) return null;
  const linkable = receipt.id && (receipt.status === "recorded" || receipt.status === "incomplete");
  return <div className={`audit-feedback ${receipt.status}`} role={receipt.status === "recorded" ? undefined : "status"}>
    <FileClock size={15} /><span>{t(receipt.status === "recorded" ? "auditRecorded" : receipt.status === "incomplete" ? "auditIncomplete" : receipt.status === "unavailable" ? "auditUnavailable" : "auditNotRecorded")}</span>
    {linkable && onOpen && <button type="button" onClick={() => onOpen(receipt.id!)}>{t("auditOpen")}</button>}
  </div>;
}