"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Database, FileClock, FilePlus2, RefreshCw, RotateCcw, Search, Upload, X } from "lucide-react";
import { connectorDetailSchema, connectorListSchema, connectorSeedResponseSchema, connectorSyncResponseSchema, type ConnectorDetail, type ConnectorList } from "../lib/esp/connector-contracts";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import { knowledgeAreas } from "./knowledge-import";
import { useLocale } from "./locale-provider";
import { connectorErrorKey, ConnectorRequestFailure, connectorText, type ConnectorTextKey } from "../lib/esp/connector-locale";
import { libraryText } from "../lib/esp/knowledge-library-locale";
import type { Locale } from "../lib/esp/locale";

const changes = ["new", "changed", "unchanged", "unavailable"] as const;
const tabs = [{ id: "preview" }, { id: "versions" }, { id: "history" }] as const;

export function connectorMessage(code: unknown, locale: Locale = "zh-CN") {
  return connectorText(locale, connectorErrorKey(code));
}

function listItem(detail: ConnectorDetail): ConnectorList["sources"][number] {
  return {
    id: detail.sourceId, title: detail.source?.input.title ?? detail.sourceId, filename: detail.source?.input.filename ?? null,
    documentNumber: detail.source?.input.documentNumber ?? null, skillId: detail.source?.input.skillId ?? null,
    change: detail.change, syncStatus: detail.state?.status ?? null, modifiedAt: detail.source?.modifiedAt ?? null,
    lastDocumentId: detail.state?.lastSuccess?.documentId ?? null, error: detail.sourceError ?? detail.state?.lastError ?? null,
  };
}

export function BlobConnectorView({ selectedId, onSelect, onOpenDocument, onOpenAudit }: {
  selectedId: string | null; onSelect: (id: string | null) => void;
  onOpenDocument: (id: string, audit?: AuditReceipt) => void; onOpenAudit: (id: string) => void;
}) {
  const { locale } = useLocale();
  const text = (key: ConnectorTextKey) => connectorText(locale, key);
  const documentText = (key: Parameters<typeof libraryText>[1]) => libraryText(locale, key);
  const [library, setLibrary] = useState<ConnectorList | null>(null);
  const [detail, setDetail] = useState<ConnectorDetail | null>(null);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState<"sync" | "seed" | "page" | null>(null);
  const [error, setError] = useState<ConnectorTextKey | null>(null);
  const [detailError, setDetailError] = useState<ConnectorTextKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [change, setChange] = useState("all");
  const [area, setArea] = useState("all");
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("preview");
  const [confirmation, setConfirmation] = useState<{ action: "seed" } | { action: "sync"; sourceId: string } | null>(null);
  const [audit, setAudit] = useState<{ sourceId: string | null; receipt: AuditReceipt | null } | null>(null);
  const [seedSummary, setSeedSummary] = useState<{ created: number; existing: number; failed: number } | null>(null);
  const parents = useRef(new Map<string, AuditReceipt>());

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/connectors", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const body = await response.json(); if (!response.ok) throw new ConnectorRequestFailure(connectorErrorKey(body.error));
        const parsed = connectorListSchema.parse(body); if (!controller.signal.aborted) setLibrary(parsed);
      } catch (failure) { if (!controller.signal.aborted) { setLibrary(null); setError(failure instanceof ConnectorRequestFailure ? failure.key : "requestFailure"); } }
      finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load(); return () => controller.abort();
  }, [revision]);

  const search = query.trim().toLocaleLowerCase();
  const visible = (library?.sources ?? []).filter((source) => (change === "all" || source.change === change) && (area === "all" || source.skillId === area) && `${source.id} ${source.title} ${source.documentNumber ?? ""}`.toLocaleLowerCase().includes(search));
  const activeId = selectedId ?? visible[0]?.id;
  const displayed = detail?.sourceId === activeId ? detail : null;

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/connectors/blob-knowledge/${activeId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const body = await response.json(); if (!response.ok) throw new ConnectorRequestFailure(connectorErrorKey(body.error));
        const parsed = connectorDetailSchema.parse(body);
        if (!controller.signal.aborted) {
          setDetail(parsed); setDetailError(null);
          setLibrary((current) => current ? { ...current, sources: current.sources.some((source) => source.id === parsed.sourceId) ? current.sources.map((source) => source.id === parsed.sourceId ? listItem(parsed) : source) : [listItem(parsed), ...current.sources] } : current);
        }
      } catch (failure) { if (!controller.signal.aborted) { setDetail(null); setDetailError(failure instanceof ConnectorRequestFailure ? failure.key : "requestFailure"); } }
    }
    void load(); return () => controller.abort();
  }, [activeId, revision]);

  function refresh() { setPending(true); setError(null); setDetailError(null); setDetail(null); setConfirmation(null); setRevision((value) => value + 1); }
  function clearFilters() { setQuery(""); setChange("all"); setArea("all"); onSelect(null); setConfirmation(null); }

  async function loadMore() {
    if (!library?.nextCursor || busy) return;
    setBusy("page"); setError(null);
    try {
      const response = await fetch(`/api/connectors?${new URLSearchParams({ cursor: library.nextCursor })}`, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
      const body = await response.json(); if (!response.ok) throw new ConnectorRequestFailure(connectorErrorKey(body.error));
      const page = connectorListSchema.parse(body);
      setLibrary((current) => ({ ...page, sources: [...new Map([...(current?.sources ?? []), ...page.sources].map((source) => [source.id, source])).values()] }));
    } catch (failure) { setError(failure instanceof ConnectorRequestFailure ? failure.key : "requestFailure"); }
    finally { setBusy(null); }
  }

  async function initialize() {
    if (busy || !library?.canSync) return;
    setBusy("seed"); setError(null); setSeedSummary(null);
    try {
      const response = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "seed_examples" }), signal: AbortSignal.timeout(65_000) });
      const body = await response.json(); setAudit({ sourceId: null, receipt: readAuditReceipt(body) });
      const parsed = connectorSeedResponseSchema.safeParse(body);
      if (parsed.success) {
        const created = parsed.data.examples.filter((example) => example.outcome === "created").length;
        const existing = parsed.data.examples.filter((example) => example.outcome === "existing").length;
        const failed = parsed.data.examples.filter((example) => example.outcome === "failed");
        setSeedSummary({ created, existing, failed: failed.length });
        if (!response.ok) throw new ConnectorRequestFailure(connectorErrorKey(failed[0]?.error));
        clearFilters(); refresh();
      } else throw new ConnectorRequestFailure(connectorErrorKey(body.error));
    } catch (failure) { setError(failure instanceof ConnectorRequestFailure ? failure.key : "requestFailure"); }
    finally { setBusy(null); setConfirmation(null); }
  }

  async function synchronize() {
    if (!displayed?.source || !displayed.canSync || busy) return;
    const source = displayed.source;
    setBusy("sync"); setDetailError(null);
    try {
      const response = await fetch(`/api/connectors/blob-knowledge/${source.id}`, {
        method: "POST", headers: { "content-type": "application/json", ...auditParentHeaders(parents.current.get(source.id)) },
        body: JSON.stringify({ action: "sync", manifestEtag: source.manifestEtag, contentEtag: source.contentEtag, fingerprint: source.fingerprint, stateEtag: displayed.stateEtag }),
        signal: AbortSignal.timeout(65_000),
      });
      const body = await response.json(); const receipt = readAuditReceipt(body); setAudit({ sourceId: source.id, receipt });
      if (receipt?.status === "recorded" || receipt?.status === "incomplete") parents.current.set(source.id, receipt);
      const parsed = connectorSyncResponseSchema.safeParse(body);
      if (parsed.success) {
        setDetail(parsed.data.detail);
        setLibrary((current) => current ? { ...current, sources: current.sources.map((item) => item.id === source.id ? listItem(parsed.data.detail) : item) } : current);
      }
      if (!response.ok) throw new ConnectorRequestFailure(connectorErrorKey(parsed.success ? parsed.data.sync.error : body.error));
      if (!parsed.success) throw new ConnectorRequestFailure("invalidResult");
    } catch (failure) { setDetailError(failure instanceof ConnectorRequestFailure ? failure.key : failure instanceof Error && failure.name === "TimeoutError" ? "timeout" : "requestFailure"); }
    finally { setBusy(null); setConfirmation(null); }
  }

  const source = displayed?.source;
  const last = displayed?.state?.lastSuccess;
  return <div className="connector-page">
    <section className="workspace-heading"><div><p className="eyebrow">ENTERPRISE CONNECTORS</p><h1>{text("title")}</h1></div><div className="workspace-tools"><button className="refresh-button" type="button" disabled={pending || Boolean(busy)} onClick={refresh}><RefreshCw size={15} />{text("refresh")}</button><button className="refresh-button" type="button" disabled={!library?.canSync || pending || Boolean(busy)} onClick={() => setConfirmation({ action: "seed" })}><FilePlus2 size={15} />{text("initialize")}</button></div></section>
    <section className="connector-definition" aria-label={text("configuration")}><div><Database size={20} /><h2>{text("name")}</h2><span>v0.1.0</span></div><dl><div><dt>{text("connection")}</dt><dd>{text("identity")}</dd></div><div><dt>{text("scope")}</dt><dd><code>{library?.connector.container ?? "audit"}/{library?.connector.prefix ?? "connector-sources/knowledge/"}</code></dd></div><div><dt>{text("target")}</dt><dd>{text("draftTarget")}</dd></div><div><dt>{text("config")}</dt><dd>{text(library ? library.connector.configured ? "configured" : "notConfigured" : pending ? "loading" : "notAvailable")}</dd></div></dl></section>
    {confirmation?.action === "seed" && <div className="connector-confirm" role="group" aria-label={text("seedConfirm")}><p>{text("seedWarning")}</p><button className="kb-primary" type="button" disabled={Boolean(busy)} onClick={() => void initialize()}><Check size={15} />{text(busy === "seed" ? "seeding" : "seedAction")}</button><button className="icon-button" type="button" title={text("seedCancel")} aria-label={text("seedCancel")} disabled={Boolean(busy)} onClick={() => setConfirmation(null)}><X size={16} /></button></div>}
    {seedSummary && <p className="connector-notice" role="status">{text("createdCount")} {seedSummary.created.toLocaleString(locale)} · {text("existingCount")} {seedSummary.existing.toLocaleString(locale)} · {text("failedCount")} {seedSummary.failed.toLocaleString(locale)}</p>}{audit?.sourceId === null && <AuditFeedback receipt={audit.receipt} onOpen={onOpenAudit} />}
    <div className="case-toolbar connector-toolbar"><label className="case-search"><Search size={16} /><input type="search" aria-label={text("search")} value={query} placeholder={text("searchHint")} disabled={Boolean(busy)} onChange={(event) => { setQuery(event.target.value); onSelect(null); setConfirmation(null); }} /></label><select aria-label={text("changeFilter")} value={change} disabled={Boolean(busy)} onChange={(event) => { setChange(event.target.value); onSelect(null); setConfirmation(null); }}><option value="all">{text("allChanges")}</option>{changes.map((value) => <option key={value} value={value}>{text(value)}</option>)}</select><select aria-label={text("area")} value={area} disabled={Boolean(busy)} onChange={(event) => { setArea(event.target.value); onSelect(null); setConfirmation(null); }}><option value="all">{documentText("allAreas")}</option>{(Object.keys(knowledgeAreas) as (keyof typeof knowledgeAreas)[]).map((value) => <option key={value} value={value}>{documentText(value)}</option>)}</select><button className="icon-button" type="button" title={text("reset")} aria-label={text("reset")} disabled={Boolean(busy)} onClick={clearFilters}><RotateCcw size={16} /></button><span className="case-count" role="status">{visible.length} / {library?.sources.length ?? 0}</span></div>
    {error && <div className="error-banner" role="alert">{text(error)}</div>}{pending && <p className="catalog-loading" role="status">{text("loadingSources")}</p>}
    <div className="connector-layout"><section className="connector-sources" aria-label={text("sourceList")}><table className="connector-table"><caption className="sr-only">{text("caption")}</caption><thead><tr><th scope="col">{text("sourceDocument")}</th><th scope="col">{text("difference")}</th><th scope="col">{text("sync")}</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className={item.id === activeId ? "selected" : ""}><td><button className="connector-select" type="button" disabled={Boolean(busy)} aria-pressed={item.id === activeId} onClick={() => { onSelect(item.id); setConfirmation(null); setDetailError(null); setTab("preview"); }}><strong>{item.title}</strong><small>{item.id}</small><small>{item.documentNumber ?? text("manifestUnread")}</small></button></td><td><span className={`connector-state ${item.change}`}>{text(item.change)}</span></td><td><span className={`connector-state ${item.syncStatus ?? "none"}`}>{text(item.syncStatus === "syncing" ? "syncing" : item.syncStatus === "error" ? "syncError" : item.syncStatus === "idle" ? "idle" : "notSynced")}</span></td></tr>)}</tbody></table>{!pending && !error && !visible.length && <div className="records-empty"><Database size={26} /><span>{text(library?.sources.length ? "noMatches" : "noSources")}</span></div>}{library?.nextCursor && <button className="refresh-button connector-more" type="button" disabled={pending || Boolean(busy)} onClick={() => void loadMore()}>{text("loadMore")}</button>}</section>
      <aside className="connector-detail" aria-label={text("detail")}>{detailError && <div className="error-banner" role="alert">{text(detailError)}</div>}{audit?.sourceId === activeId && <AuditFeedback receipt={audit?.receipt} onOpen={onOpenAudit} />}{displayed ? <>
        <p className="eyebrow">{displayed.sourceId}</p><h2>{source?.input.title ?? text("unavailable")}</h2><div className="connector-detail-state"><span className={`connector-state ${displayed.change}`}>{text(displayed.change)}</span><span>{text("synthetic")}</span></div>
        {displayed.sourceError && <div className="error-banner" role="status">{connectorMessage(displayed.sourceError, locale)}</div>}{displayed.state?.lastError && !detailError && <div className="error-banner" role="status">{connectorMessage(displayed.state.lastError, locale)}</div>}
        {source && <dl className="connector-metadata"><div><dt>{documentText("area")}</dt><dd>{documentText(source.input.skillId)}</dd></div><div><dt>{documentText("documentNumber")}</dt><dd>{source.input.documentNumber}</dd></div><div><dt>{documentText("owner")}</dt><dd>{source.input.owner}</dd></div><div><dt>{documentText(source.input.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")}</dt><dd>{source.input.effectiveDate}</dd></div><div><dt>{text("contentFile")}</dt><dd>{source.input.filename} · {source.bytes.toLocaleString(locale)} bytes</dd></div><div><dt>{text("modifiedAt")}</dt><dd><time dateTime={source.modifiedAt}>{new Date(source.modifiedAt).toLocaleString(locale)}</time></dd></div></dl>}
        <div className="connector-actions"><button className="kb-primary" type="button" disabled={!displayed.canSync || pending || Boolean(busy)} onClick={() => setConfirmation({ action: "sync", sourceId: displayed.sourceId })}><Upload size={15} />{text(displayed.change === "unchanged" ? "verifySync" : "syncDraft")}</button>{displayed.document && <button className="refresh-button" type="button" disabled={Boolean(busy)} onClick={() => onOpenDocument(displayed.document!.entry.id, parents.current.get(displayed.sourceId))}><ArrowUpRight size={15} />{text("openLibrary")}</button>}</div>
        {displayed.document && <p className="connector-notice">{text("linkedDocument")}: {documentText(displayed.document.entry.status)} · {displayed.document.entry.chunkCount} {documentText("chunks")}</p>}
        {confirmation?.action === "sync" && confirmation.sourceId === displayed.sourceId && <div className="connector-confirm" role="group" aria-label={text("syncConfirm")}><p>{text(displayed.change === "unchanged" ? "reuseWarning" : "syncWarning")}</p><button className="kb-primary" type="button" disabled={Boolean(busy)} onClick={() => void synchronize()}><Check size={15} />{text(busy === "sync" ? "syncing" : "syncAction")}</button><button className="icon-button" type="button" title={text("syncCancel")} aria-label={text("syncCancel")} disabled={Boolean(busy)} onClick={() => setConfirmation(null)}><X size={16} /></button></div>}
        {last && last.documentId !== displayed.document?.entry.id && <button className="connector-link" type="button" disabled={Boolean(busy)} onClick={() => onOpenDocument(last.documentId, parents.current.get(displayed.sourceId))}><FileClock size={14} />{text("previousDocument")}</button>}
        <div className="catalog-tabs connector-tabs" role="tablist" aria-label={text("detailViews")}>{tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`connector-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="connector-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
          if (next === null) return; event.preventDefault(); setTab(tabs[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{text(item.id)}</button>)}</div>
        <div className="connector-panel" id="connector-panel" role="tabpanel" aria-labelledby={`connector-tab-${tab}`} tabIndex={0}>
          {tab === "preview" && (source ? <><p className="connector-notice">{source.chunks.length} {documentText("chunks")} · {source.input.content.length} {documentText("characters")}</p>{source.chunks.map((chunk) => <details className="connector-chunk" key={chunk.id} open={source.chunks.length === 1}><summary>{documentText("chunks")} {chunk.number} · {chunk.start}-{chunk.end} · {chunk.content.length} {documentText("characters")}</summary><pre>{chunk.content}</pre></details>)}</> : <p className="connector-notice">{text("noContent")}</p>)}
          {tab === "versions" && <><dl className="connector-metadata"><div><dt>{text("fingerprint")}</dt><dd><code>{source?.fingerprint ?? text("notAvailable")}</code></dd></div><div><dt>{text("lastFingerprint")}</dt><dd><code>{last?.fingerprint ?? text("noSuccess")}</code></dd></div><div><dt>{text("lastSuccess")}</dt><dd>{last ? new Date(last.at).toLocaleString(locale) : text("notSynced")}</dd></div>{source && <><div><dt>{text("contentHash")}</dt><dd><code>{source.metadata.contentSha256}</code></dd></div><div><dt>{text("manifestEtag")}</dt><dd><code>{source.manifestEtag}</code></dd></div><div><dt>{text("contentEtag")}</dt><dd><code>{source.contentEtag}</code></dd></div><div><dt>{text("targetId")}</dt><dd><code>{source.documentId}</code></dd></div></>}</dl>{source && <details className="plugin-json"><summary>{text("manifestJson")}</summary><pre>{JSON.stringify(source.metadata, null, 2)}</pre></details>}</>}
          {tab === "history" && <>{displayed.state?.status === "syncing" && <p className="connector-notice" role="status">{text("startedAt")} {displayed.state.activeRun ? new Date(displayed.state.activeRun.startedAt).toLocaleString(locale) : text("unknown")}</p>}{!displayed.state?.history.length ? <p className="connector-notice">{text("noHistory")}</p> : <ol className="connector-history">{[...displayed.state.history].reverse().map((run) => <li key={run.id}><div><strong>{text(run.outcome)}</strong><time dateTime={run.completedAt}>{new Date(run.completedAt).toLocaleString(locale)}</time></div><code>{run.actor}</code><code>{run.documentId}</code>{run.error && <p>{connectorMessage(run.error, locale)}</p>}</li>)}</ol>}</>}
        </div>
      </> : !detailError && <div className="records-empty"><Database size={26} /><span>{text(activeId ? "detailLoading" : "noDetail")}</span></div>}</aside>
    </div>
  </div>;
}