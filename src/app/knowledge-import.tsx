"use client";

import { useRef, useState } from "react";
import { Eye, FilePlus2, Save, Upload, X } from "lucide-react";
import { z } from "zod";
import { knowledgeChunkSchema, knowledgeImportSchema, libraryDetailSchema, type KnowledgeChunk, type KnowledgeImport, type LibraryDetail } from "../lib/esp/knowledge-library-contracts";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";
import { libraryErrorKey, LibraryRequestFailure, libraryText, type LibraryTextKey } from "../lib/esp/knowledge-library-locale";
import type { Locale } from "../lib/esp/locale";

export const knowledgeAreas = {
  "search-company-policy": "人事制度",
  "search-expense-policy": "差旅报销",
  "search-procurement-guide": "采购流程",
  "search-security-guidance": "信息安全",
  "search-software-catalog": "软件服务",
} as const;

export function knowledgeRequestMessage(code?: string, locale: Locale = "zh-CN") {
  return libraryText(locale, libraryErrorKey(code));
}

const previewSchema = z.object({ content: z.string(), chunks: z.array(knowledgeChunkSchema) });

export function KnowledgeImportForm({ onSaved, onCancel, onOpenAudit }: { onSaved: (document: LibraryDetail) => void; onCancel: () => void; onOpenAudit?: (id: string) => void }) {
  const { locale } = useLocale();
  const text = (key: LibraryTextKey) => libraryText(locale, key);
  const [form, setForm] = useState<Omit<KnowledgeImport, "simulated"> & { simulated: boolean }>({
    title: "", skillId: "search-company-policy", documentNumber: "SIM-HR-NEW-001", owner: "",
    effectiveDate: new Date().toISOString().slice(0, 10), dataKind: "policy", filename: "document.txt", content: "", simulated: false,
  });
  const [preview, setPreview] = useState<{ content: string; chunks: KnowledgeChunk[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LibraryTextKey | null>(null);
  const [audit, setAudit] = useState<AuditReceipt | null>(null);
  const parentAudit = useRef<AuditReceipt | null>(null);

  function update(changes: Partial<typeof form>) {
    setAudit(null); parentAudit.current = null;
    setForm((current) => ({ ...current, ...changes }));
    setPreview(null);
    setError(null);
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      if (!/\.(txt|md)$/i.test(file.name) || file.size > 160_000) throw new LibraryRequestFailure("fileInvalid");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (content.length > 48_000) throw new LibraryRequestFailure("contentTooLong");
      update({ filename: file.name, content });
    } catch (failure) {
      setError(failure instanceof LibraryRequestFailure ? failure.key : "fileReadFailed");
    } finally { setPending(false); }
  }

  async function submit(save: boolean) {
    setError(null);
    const parsed = knowledgeImportSchema.safeParse(form);
    if (!parsed.success) {
      setError("fieldsInvalid");
      return;
    }
    if (save && !preview) return;
    setPending(true);
    try {
      const response = await fetch(save ? "/api/knowledge" : "/api/knowledge/preview", {
        method: "POST", headers: { "content-type": "application/json", ...auditParentHeaders(parentAudit.current) }, body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json();
      const receipt = readAuditReceipt(payload); setAudit(receipt);
      if (receipt?.status === "recorded" || receipt?.status === "incomplete") parentAudit.current = receipt;
      if (!response.ok) throw new LibraryRequestFailure(libraryErrorKey(payload.error));
      if (save) onSaved(libraryDetailSchema.parse(payload));
      else setPreview(previewSchema.parse(payload));
    } catch (failure) { setError(failure instanceof LibraryRequestFailure ? failure.key : "unavailable"); }
    finally { setPending(false); }
  }

  return (
    <section className="kb-import" aria-label={text("importLabel")}>
      <header className="kb-import-header"><h2><Upload size={18} />{text("importTitle")}</h2><button className="icon-button" type="button" title={text("cancelImport")} aria-label={text("cancelImport")} onClick={onCancel} disabled={pending}><X size={18} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
        <fieldset disabled={pending}>
          <label>{text("documentTitle")}<input aria-label={text("documentTitle")} value={form.title} maxLength={120} required onChange={(event) => update({ title: event.target.value })} /></label>
          <label>{text("area")}<select aria-label={text("area")} value={form.skillId} onChange={(event) => update({ skillId: event.target.value as KnowledgeImport["skillId"] })}>{(Object.keys(knowledgeAreas) as KnowledgeImport["skillId"][]).map((value) => <option key={value} value={value}>{text(value)}</option>)}</select></label>
          <label>{text("documentNumber")}<input aria-label={text("documentNumber")} value={form.documentNumber} pattern="SIM-(?:[A-Z0-9]|-){3,60}" maxLength={64} required onChange={(event) => update({ documentNumber: event.target.value.toUpperCase() })} /></label>
          <label>{text("owner")}<input aria-label={text("owner")} value={form.owner} maxLength={80} required onChange={(event) => update({ owner: event.target.value })} /></label>
          <label>{text(form.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")}<input aria-label={text("documentDate")} type="date" value={form.effectiveDate} required onChange={(event) => update({ effectiveDate: event.target.value })} /></label>
          <label>{text("dataKind")}<select aria-label={text("dataKind")} value={form.dataKind} onChange={(event) => update({ dataKind: event.target.value as KnowledgeImport["dataKind"] })}><option value="policy">{text("policy")}</option><option value="snapshot">{text("snapshot")}</option></select></label>
          <label className="kb-full">{text("fileInput")}<input type="file" accept=".txt,.md,text/plain,text/markdown" aria-label={text("upload")} onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
          <label className="kb-full">{text("content")} <span className="kb-text-count">{form.content.length} / 48000 · {form.filename}</span><textarea aria-label={text("content")} rows={9} value={form.content} minLength={10} maxLength={48_000} required onChange={(event) => update({ content: event.target.value })} /></label>
          <label className="kb-full kb-checkbox"><input type="checkbox" checked={form.simulated} required onChange={(event) => update({ simulated: event.target.checked })} />{text("simulatedCheck")}</label>
        </fieldset>
        {error && <div className="error-banner" role="alert">{text(error)}</div>}
        <AuditFeedback receipt={audit} onOpen={onOpenAudit} />
        <div className="kb-form-actions">
          <button className="refresh-button" type="button" disabled={pending} onClick={() => update({
            title: "星港交通补贴补充办法（模拟）", skillId: "search-expense-policy", documentNumber: "SIM-FIN-PORT-001", owner: "财务模拟组",
            filename: "starport.md", dataKind: "policy", simulated: true, content: "# 星港交通补贴补充办法（模拟）\n\n【模拟数据】仅适用于虚构组织澄川数科的星港测试项目。\n\n星港园区接驳交通补贴为每人每日37元，需要提交出勤记录和接驳车凭证。不与其他交通费用重复报销。该条款为演示数据，不代表真实公司制度。",
          })}><FilePlus2 size={15} />{text("template")}</button>
          <button className="refresh-button" type="submit" disabled={pending}><Eye size={15} />{text("preview")}</button>
          <button className="kb-primary" type="button" disabled={pending || !preview} onClick={() => void submit(true)}><Save size={15} />{text("save")}</button>
        </div>
      </form>
      {preview && <div className="kb-import-preview" aria-label={text("importPreview")}><h3>{preview.chunks.length} {text("chunks")} · {preview.content.length} {text("characters")}</h3>{preview.chunks.map((chunk) => <details key={chunk.id} open={preview.chunks.length === 1}><summary>{text("chunks")} {chunk.number} · {chunk.content.length} {text("characters")} · {text("range")} {chunk.start}-{chunk.end}</summary><pre>{chunk.content}</pre></details>)}</div>}
    </section>
  );
}