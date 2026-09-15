"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenText, Check, ExternalLink, EyeOff, RefreshCw, Search, Upload, X } from "lucide-react";
import { libraryDetailSchema, libraryListSchema, type LibraryDetail, type LibraryItem, type LibraryList } from "../lib/esp/knowledge-library-contracts";
import { KnowledgeImportForm, knowledgeAreas, knowledgeRequestMessage } from "./knowledge-import";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";
import { libraryErrorKey, LibraryRequestFailure, libraryText, type LibraryTextKey } from "../lib/esp/knowledge-library-locale";

const statuses = ["draft", "indexing", "published", "inactive", "error"] as const;

export function KnowledgeLibraryView({ selectedId, onSelect, onTest, onOpenAudit, initialAudit, onOpenConnector }: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTest: (skillId: string, query: string, audit?: AuditReceipt) => void;
  onOpenAudit?: (id: string) => void;
  initialAudit?: AuditReceipt | null;
  onOpenConnector?: (id: string) => void;
}) {
  const { locale } = useLocale();
  const text = (key: LibraryTextKey) => libraryText(locale, key);
  const [library, setLibrary] = useState<LibraryList | null>(null);
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LibraryTextKey | null>(null);
  const [detailError, setDetailError] = useState<LibraryTextKey | null>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("all");
  const [status, setStatus] = useState("all");
  const [area, setArea] = useState("all");
  const [tab, setTab] = useState<"source" | "chunks">("source");
  const [confirmAction, setConfirmAction] = useState<"publish" | "deactivate" | null>(null);
  const auditHistory = useRef(new Map<string, AuditReceipt>(selectedId && initialAudit ? [[selectedId, initialAudit]] : []));

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/knowledge", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        const body = await response.json();
        if (!response.ok) throw new LibraryRequestFailure(libraryErrorKey(body.error));
        const result = libraryListSchema.parse(body);
        if (!controller.signal.aborted) setLibrary(result);
      } catch (failure) { if (!controller.signal.aborted) { setLibrary(null); setError(failure instanceof LibraryRequestFailure ? failure.key : "unavailable"); } }
      finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  const items = [...(library?.documents ?? []), ...(library?.builtins ?? [])];
  const query = search.trim().toLocaleLowerCase();
  const visible = items.filter((item) => (origin === "all" || item.origin === origin) && (status === "all" || item.status === status) &&
    (area === "all" || item.skillId === area) && `${item.title} ${item.documentNumber} ${item.owner}`.toLocaleLowerCase().includes(query));
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
  const activeId = selectedId && library && !items.some((item) => item.id === selectedId) ? selectedId : selected?.id;

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/knowledge/${activeId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json();
        if (!response.ok) throw new LibraryRequestFailure(libraryErrorKey(body.error));
        const result = libraryDetailSchema.parse(body);
        if (!controller.signal.aborted) {
          setDetail({ ...result, audit: auditHistory.current.get(result.entry.id) }); setDetailError(null);
          if (result.entry.origin === "imported") setLibrary((current) => current && !current.documents.some((item) => item.id === result.entry.id) ? { ...current, documents: [result.entry, ...current.documents] } : current);
        }
      } catch (failure) { if (!controller.signal.aborted) { setDetail(null); setDetailError(failure instanceof LibraryRequestFailure ? failure.key : "unavailable"); } }
    }
    void load();
    return () => controller.abort();
  }, [activeId, detailRevision]);

  const displayed = detail?.entry.id === activeId ? detail : null;

  function refresh() {
    setPending(true); setError(null); setDetail(null); setDetailError(null); setConfirmAction(null);
    setRevision((current) => current + 1); setDetailRevision((current) => current + 1);
  }

  async function loadMore() {
    if (!library?.nextCursor || busy) return;
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ cursor: library.nextCursor });
      const response = await fetch(`/api/knowledge?${params}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body = await response.json();
      if (!response.ok) throw new LibraryRequestFailure(libraryErrorKey(body.error));
      const page = libraryListSchema.parse(body);
      setLibrary((current) => ({ ...page, documents: [...new Map([...(current?.documents ?? []), ...page.documents].map((item) => [item.id, item])).values()] }));
    } catch (failure) { setError(failure instanceof LibraryRequestFailure ? failure.key : "unavailable"); }
    finally { setBusy(false); }
  }

  async function applyAction() {
    if (!displayed?.etag || !confirmAction || busy) return;
    setBusy(true); setDetailError(null);
    try {
      const response = await fetch(`/api/knowledge/${displayed.entry.id}`, {
        method: "POST", headers: { "content-type": "application/json", ...auditParentHeaders(auditHistory.current.get(displayed.entry.id)) },
        body: JSON.stringify({ action: confirmAction, etag: displayed.etag }), signal: AbortSignal.timeout(65_000),
      });
      const body = await response.json();
      const audit = readAuditReceipt(body);
      if (audit) {
        if (audit.status === "recorded" || audit.status === "incomplete") auditHistory.current.set(displayed.entry.id, audit);
        setDetail((current) => current?.entry.id === displayed.entry.id ? { ...current, audit } : current);
      }
      const parsed = libraryDetailSchema.safeParse(body);
      if (parsed.success) {
        setDetail(parsed.data);
        setLibrary((current) => current ? { ...current, documents: current.documents.map((item) => item.id === parsed.data.entry.id ? parsed.data.entry : item) } : current);
      }
      if (!response.ok) throw new LibraryRequestFailure(libraryErrorKey(parsed.success ? parsed.data.entry.lastError : body.error));
      if (!parsed.success) throw new LibraryRequestFailure("invalidResponse");
    } catch (failure) { setDetailError(failure instanceof LibraryRequestFailure ? failure.key : "unavailable"); }
    finally { setBusy(false); setConfirmAction(null); }
  }

  return (
    <div className="kb-page">
      <section className="workspace-heading"><div><p className="eyebrow">KNOWLEDGE LIBRARY</p><h1>{text("title")}</h1></div><div className="workspace-tools">
        <button className="refresh-button" type="button" onClick={refresh} disabled={pending || busy || importing}><RefreshCw size={15} />{text("refresh")}</button>
        <button className="kb-primary" type="button" disabled={!library?.canManage || busy || importing} onClick={() => setImporting(true)}><Upload size={15} />{text("import")}</button>
      </div></section>
      <div className="kb-summary"><span>{text("simulation")}</span><span>{library?.builtins.length ?? 0} {text("builtinCount")} · {library?.documents.length ?? 0} {text("importedCount")}{library?.nextCursor ? ` (${text("more")})` : ""}</span><span>{text(library?.canManage ? "management" : "readOnly")}</span></div>
      {error && <div className="error-banner" role="alert">{text(error)}</div>}
      {importing ? <KnowledgeImportForm onOpenAudit={onOpenAudit} onCancel={() => setImporting(false)} onSaved={(saved) => {
        if (saved.audit) auditHistory.current.set(saved.entry.id, saved.audit);
        setLibrary((current) => current ? { ...current, documents: [saved.entry, ...current.documents.filter((item) => item.id !== saved.entry.id)] } : current);
        setDetail(saved); setDetailError(null); setConfirmAction(null); setTab("source");
        setImporting(false); setOrigin("imported"); setStatus("all"); setArea("all"); setSearch(""); onSelect(saved.entry.id);
      }} /> : <>
        <div className="case-toolbar kb-toolbar"><label className="case-search"><Search size={16} /><input type="search" aria-label={text("search")} placeholder={text("searchHint")} value={search} disabled={busy} onChange={(event) => { setSearch(event.target.value); setConfirmAction(null); }} /></label>
          <select aria-label={text("origin")} value={origin} disabled={busy} onChange={(event) => { setOrigin(event.target.value); setConfirmAction(null); }}><option value="all">{text("allOrigins")}</option><option value="builtin">{text("builtin")}</option><option value="imported">{text("imported")}</option></select>
          <select aria-label={text("status")} value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setConfirmAction(null); }}><option value="all">{text("allStatuses")}</option>{statuses.map((value) => <option key={value} value={value}>{text(value)}</option>)}</select>
          <select aria-label={text("area")} value={area} disabled={busy} onChange={(event) => { setArea(event.target.value); setConfirmAction(null); }}><option value="all">{text("allAreas")}</option>{(Object.keys(knowledgeAreas) as LibraryItem["skillId"][]).map((value) => <option key={value} value={value}>{text(value)}</option>)}</select>
          <span className="case-count" role="status">{visible.length.toLocaleString(locale)}</span>
        </div>
        {pending && <p className="catalog-loading" role="status">{text("loading")}</p>}
        <div className="kb-layout">
          <section className="kb-list" aria-label={text("list")}><table className="kb-table"><caption className="sr-only">{text("caption")}</caption><thead><tr><th scope="col">{text("document")}</th><th scope="col">{text("status")}</th><th scope="col">{text("chunks")}</th></tr></thead><tbody>
            {visible.map((item) => <tr key={item.id} className={item.id === activeId ? "selected" : ""}><td><button className="kb-select" type="button" disabled={busy} aria-pressed={item.id === activeId} onClick={() => { onSelect(item.id); setConfirmAction(null); setDetailError(null); setTab("source"); }}><strong>{item.title}</strong><small>{item.documentNumber} · {text(item.origin)}</small></button></td><td><span className={`kb-status ${item.status}`}>{text(item.status)}</span></td><td>{item.chunkCount.toLocaleString(locale)}</td></tr>)}
          </tbody></table>
            {!pending && !error && !visible.length && <div className="records-empty"><BookOpenText size={26} /><span>{text("noMatches")}</span></div>}
            {library?.nextCursor && <button className="refresh-button kb-more" type="button" onClick={() => void loadMore()} disabled={busy}>{text("loadMore")}</button>}
          </section>
          <aside className="kb-detail" aria-label={text("detail")}>
            {detailError && <div className="error-banner" role="alert">{text(detailError)}</div>}
            <AuditFeedback receipt={displayed?.audit} onOpen={onOpenAudit} />
            {displayed ? <>
              <p className="eyebrow">{displayed.entry.documentNumber}</p><h2>{displayed.entry.title}</h2>
              <div className="kb-detail-state"><span className={`kb-status ${displayed.entry.status}`}>{text(displayed.entry.status)}</span><span className="sample-label">{text("synthetic")}</span><span>{text("version")} {displayed.entry.version}</span></div>
              {displayed.entry.knowledgeBase && <p className="parallel-task-meta"><span>{displayed.entry.knowledgeBase.name}</span><code>{displayed.entry.knowledgeBase.indexName}</code></p>}
              {displayed.provenance && <div className="connector-provenance"><span>{text("blobSource")}</span><code>{displayed.provenance.sourceId}</code><time dateTime={displayed.provenance.syncedAt}>{new Date(displayed.provenance.syncedAt).toLocaleString(locale)}</time>{onOpenConnector && <button className="connector-link" type="button" onClick={() => onOpenConnector(displayed.provenance!.sourceId)}>{text("sourceHistory")}</button>}</div>}
              <dl className="kb-metadata"><div><dt>{text("area")}</dt><dd>{text(displayed.entry.skillId)}</dd></div><div><dt>{text("owner")}</dt><dd>{displayed.entry.owner}</dd></div><div><dt>{text(displayed.entry.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")}</dt><dd>{displayed.entry.effectiveDate}</dd></div><div><dt>{text("filename")}</dt><dd>{displayed.entry.filename}</dd></div><div><dt>{text("chunks")}</dt><dd>{displayed.entry.chunkCount} · {displayed.content.length} {text("characters")}</dd></div></dl>
              {displayed.entry.lastError && !detailError && <div className="error-banner" role="status">{knowledgeRequestMessage(displayed.entry.lastError, locale)}</div>}
              <div className="kb-detail-actions">
                {displayed.canManage && <>
                  <button className="kb-primary" type="button" disabled={busy || pending} onClick={() => setConfirmAction("publish")}><Upload size={15} />{text(displayed.entry.status === "error" ? "retryPublish" : displayed.entry.status === "published" ? "reindex" : "publish")}</button>
                  <button className="refresh-button" type="button" disabled={busy || pending} onClick={() => setConfirmAction("deactivate")}><EyeOff size={15} />{text("deactivate")}</button>
                </>}
                {displayed.entry.status === "published" && <button className="refresh-button" type="button" disabled={busy} onClick={() => onTest(displayed.entry.skillId, `请查询${displayed.entry.documentNumber}「${displayed.entry.title}」的主要规定`, displayed.audit)}><Search size={15} />{text("retrievalTest")}</button>}
              </div>
              {confirmAction && <div className="kb-confirm" role="group" aria-label={text("confirmGroup")}><p>{text(confirmAction === "publish" ? "publishWarning" : "deactivateWarning")}</p><button className="kb-primary" type="button" disabled={busy} onClick={() => void applyAction()}><Check size={15} />{text(busy ? "processing" : confirmAction === "publish" ? "confirmPublish" : "confirmDeactivate")}</button><button className="icon-button" type="button" title={text("cancelAction")} aria-label={text("cancelAction")} disabled={busy} onClick={() => setConfirmAction(null)}><X size={16} /></button></div>}
              <div className="kb-tabs" role="tablist" aria-label={text("contentViews")}>{(["source", "chunks"] as const).map((value) => <button key={value} type="button" role="tab" id={`kb-tab-${value}`} aria-controls="kb-content" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault(); const next = event.key === "Home" ? "source" : event.key === "End" ? "chunks" : value === "source" ? "chunks" : "source"; setTab(next);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#kb-tab-${next}`)?.focus();
              }}>{text(value === "source" ? "source" : "chunkPreview")}</button>)}</div>
              <div id="kb-content" className="kb-content" role="tabpanel" aria-labelledby={`kb-tab-${tab}`} tabIndex={0}>{tab === "source" ? <pre>{displayed.content}</pre> : displayed.chunks.map((chunk) => <details key={chunk.id} open={displayed.chunks.length === 1}><summary>{text("chunks")} {chunk.number} · {chunk.content.length} {text("characters")}</summary><pre>{chunk.content}</pre>{displayed.entry.status === "published" && <a href={`/knowledge/${chunk.id}`} target="_blank" rel="noreferrer">{text("sourceLink")} <ExternalLink size={13} /></a>}</details>)}</div>
            </> : !detailError && <div className="records-empty"><BookOpenText size={26} /><span>{text(selected ? "detailLoading" : "noDetail")}</span></div>}
          </aside>
        </div>
      </>}
    </div>
  );
}