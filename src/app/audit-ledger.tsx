"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Download, FileClock, GitBranch, Link2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { auditDetailSchema, auditIdSchema, auditKindSchema, auditListSchema, auditOutcomeSchema, type AuditDetail, type AuditList, type AuditReference } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";
import { auditText, auditErrorKey, AuditReadFailure, type AuditTextKey } from "../lib/esp/audit-locale";

const statuses = [...auditOutcomeSchema.shape.status.options, "incomplete"] as const;

function combinedReferences(record: AuditDetail) {
  return [...new Map([...record.start.references, ...(record.result?.references ?? [])].map((reference) => [`${reference.type}:${reference.id}:${reference.version ?? ""}`, reference])).values()];
}

export function AuditLedgerView({ selectedId, onSelect, onReference }: {
  selectedId: string | null; onSelect: (id: string | null) => void; onReference: (reference: AuditReference) => void;
}) {
  const { locale } = useLocale();
  const text = (key: AuditTextKey) => auditText(locale, key);
  const [ledger, setLedger] = useState<AuditList | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [pending, setPending] = useState(true);
  const [morePending, setMorePending] = useState(false);
  const [error, setError] = useState<AuditTextKey | null>(null);
  const [detailError, setDetailError] = useState<AuditTextKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [traceId, setTraceId] = useState("");
  const [reference, setReference] = useState("");
  const [idInput, setIdInput] = useState(selectedId ?? "");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams(); if (traceId) params.set("traceId", traceId); if (reference) params.set("reference", reference);
        const response = await fetch(`/api/audit?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        const body = await response.json(); if (!response.ok) throw new AuditReadFailure(auditErrorKey(body.error));
        const parsed = auditListSchema.parse(body); if (!controller.signal.aborted) setLedger(parsed);
      } catch (failure) { if (!controller.signal.aborted) { setLedger(null); setError(failure instanceof AuditReadFailure ? failure.key : "errorUnavailable"); } }
      finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load(); return () => controller.abort();
  }, [traceId, reference, revision]);

  const search = query.trim().toLocaleLowerCase();
  const visible = (ledger?.records ?? []).filter((record) => (kind === "all" || record.start.kind === kind) && (status === "all" || (record.result?.status ?? "incomplete") === status) &&
    `${record.start.id} ${record.start.requestId} ${record.start.action} ${combinedReferences(record).map((item) => item.id).join(" ")}`.toLocaleLowerCase().includes(search));
  const activeId = selectedId ?? visible[0]?.start.id;
  const displayed = detail?.start.id === activeId ? detail : null;

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/audit/${activeId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json(); if (!response.ok) throw new AuditReadFailure(auditErrorKey(body.error));
        const parsed = auditDetailSchema.parse(body);
        if (!controller.signal.aborted) { setDetail(parsed); setDetailError(null); }
      } catch (failure) { if (!controller.signal.aborted) { setDetail(null); setDetailError(failure instanceof AuditReadFailure ? failure.key : "errorUnavailable"); } }
    }
    void load(); return () => controller.abort();
  }, [activeId, revision]);

  function filterChain(nextTrace = "", nextReference = "") {
    setTraceId(nextTrace); setReference(nextReference); setPending(true); setError(null); setLedger(null); setQuery(""); setKind("all"); setStatus("all"); onSelect(null); setRevision((value) => value + 1);
  }

  async function loadMore() {
    if (!ledger?.nextCursor || morePending) return;
    setMorePending(true); setError(null);
    try {
      const params = new URLSearchParams({ cursor: ledger.nextCursor }); if (traceId) params.set("traceId", traceId); if (reference) params.set("reference", reference);
      const response = await fetch(`/api/audit?${params}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body = await response.json(); if (!response.ok) throw new AuditReadFailure(auditErrorKey(body.error));
      const page = auditListSchema.parse(body);
      setLedger((current) => ({ ...page, records: [...new Map([...(current?.records ?? []), ...page.records].map((record) => [record.start.id, record])).values()] }));
    } catch (failure) { setError(failure instanceof AuditReadFailure ? failure.key : "errorUnavailable"); }
    finally { setMorePending(false); }
  }

  function downloadRecord(record: AuditDetail) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${record.start.id}.json`; link.click(); URL.revokeObjectURL(url);
  }

  return <div className="audit-page">
    <section className="workspace-heading"><div><p className="eyebrow">EXECUTION AUDIT</p><h1>{text("title")}</h1></div><button className="refresh-button" type="button" disabled={pending || morePending} onClick={() => { setError(null); setDetailError(null); setPending(true); setRevision((value) => value + 1); }}><RefreshCw size={15} />{text("refresh")}</button></section>
    <div className="audit-summary"><span>{text("scope")}</span><span>{text("order")}</span><span>{text("loaded")} {ledger?.records.length ?? 0}{ledger?.nextCursor ? ` · ${text("more")}` : ""}</span><span>{text("metadataOnly")}</span></div>
    <form className="audit-locate" aria-label={text("locate")} onSubmit={(event) => { event.preventDefault(); const id = auditIdSchema.safeParse(idInput.trim()); if (!id.success) { setDetailError("errorId"); return; } setDetailError(null); onSelect(id.data); }}><label htmlFor="audit-lookup-id">{text("id")}</label><input id="audit-lookup-id" aria-label={text("id")} value={idInput} onChange={(event) => setIdInput(event.target.value)} maxLength={50} autoComplete="off" /><button className="icon-button" type="submit" title={text("locateAction")} aria-label={text("locateAction")}><Search size={17} /></button></form>
    {(traceId || reference) && <div className="audit-scope"><Link2 size={15} /><code>{traceId || reference}</code><button className="icon-button" type="button" title={text("clear")} aria-label={text("clear")} onClick={() => filterChain()}><RotateCcw size={16} /></button></div>}
    <div className="case-toolbar audit-toolbar"><label className="case-search"><Search size={16} /><input type="search" aria-label={text("search")} placeholder={text("searchHint")} value={query} onChange={(event) => { setQuery(event.target.value); onSelect(null); }} /></label><select aria-label={text("kind")} value={kind} onChange={(event) => { setKind(event.target.value); onSelect(null); }}><option value="all">{text("allKinds")}</option>{auditKindSchema.options.map((value) => <option key={value} value={value}>{text(value)}</option>)}</select><select aria-label={text("status")} value={status} onChange={(event) => { setStatus(event.target.value); onSelect(null); }}><option value="all">{text("allStatuses")}</option>{statuses.map((value) => <option key={value} value={value}>{text(value)}</option>)}</select><span className="case-count" role="status">{visible.length.toLocaleString(locale)}</span></div>
    {error && <div className="error-banner" role="alert">{text(error)}</div>}{pending && <p className="catalog-loading" role="status">{text("loading")}</p>}
    <div className="audit-layout"><section className="audit-table-wrap" aria-label={text("list")}><table className="audit-table"><caption className="sr-only">{text("caption")}</caption><thead><tr><th scope="col">{text("action")}</th><th scope="col">{text("outcome")}</th><th scope="col">{text("startedAt")}</th><th scope="col">{text("duration")}</th></tr></thead><tbody>{visible.map((record) => <tr key={record.start.id} className={activeId === record.start.id ? "selected" : ""}><td><button className="audit-select" type="button" aria-pressed={activeId === record.start.id} onClick={() => { setDetailError(null); onSelect(record.start.id); setIdInput(record.start.id); }}><strong>{text(record.start.kind)}</strong><code>{record.start.action}</code><small>{record.start.requestId.slice(0, 8)}</small></button></td><td><span className={`audit-state ${record.result?.status ?? "incomplete"}`}>{text(record.result?.status ?? "incomplete")}</span></td><td><time dateTime={record.start.startedAt}>{new Date(record.start.startedAt).toLocaleDateString(locale)}<br />{new Date(record.start.startedAt).toLocaleTimeString(locale)}</time></td><td><code>{record.result ? `${record.result.durationMs.toLocaleString(locale)} ms` : "--"}</code></td></tr>)}</tbody></table>{!pending && !error && !visible.length && <div className="records-empty"><FileClock size={26} /><span>{text("empty")}</span></div>}{ledger?.nextCursor && <button type="button" className="refresh-button audit-more" disabled={pending || morePending} onClick={() => void loadMore()}>{text("next")}</button>}</section>
      <aside className="audit-detail" aria-label={text("detail")}>{detailError && <div className="error-banner" role="alert">{text(detailError)}</div>}{displayed ? <>
        <header><div><p className="eyebrow">{text(displayed.start.kind)}</p><h2>{displayed.start.action}</h2></div><button className="icon-button" type="button" title={text("download")} aria-label={text("download")} onClick={() => downloadRecord(displayed)}><Download size={18} /></button></header>
        <div className="audit-detail-state"><span className={`audit-state ${displayed.result?.status ?? "incomplete"}`}>{text(displayed.result?.status ?? "incomplete")}</span><span>{text(displayed.start.mutation ? "mutation" : "read")}</span><span>schema v{displayed.start.schemaVersion}</span></div>
        {!displayed.result && <div className="audit-incomplete" role="status">{text("incompleteNotice")}</div>}
        <dl className="audit-metadata"><div><dt>{text("requestId")}</dt><dd><code>{displayed.start.requestId}</code></dd></div><div><dt>{text("trace")}</dt><dd><code>{displayed.start.traceId}</code><button className="audit-text-button" type="button" onClick={() => filterChain(displayed.start.traceId)}><GitBranch size={13} />{text("sameChain")}</button></dd></div><div><dt>{text("identity")}</dt><dd><code>{displayed.start.actor.subject}</code>{text(displayed.start.actor.source)}</dd></div><div><dt>{text("permissions")}</dt><dd>{[...new Set([...displayed.start.requiredPermissions, ...(displayed.result?.requiredPermissions ?? [])])].map((permission) => <code key={permission}>{permission}</code>)}</dd></div><div><dt>{text("startedAt")}</dt><dd>{new Date(displayed.start.startedAt).toLocaleString(locale)}</dd></div>{displayed.result && <><div><dt>{text("completedAt")}</dt><dd>{new Date(displayed.result.completedAt).toLocaleString(locale)}</dd></div><div><dt>{text("durationHttp")}</dt><dd>{displayed.result.durationMs.toLocaleString(locale)} ms / {displayed.result.httpStatus}</dd></div>{displayed.result.errorCode && <div><dt>{text("errorCode")}</dt><dd><code>{displayed.result.errorCode}</code></dd></div>}</>}</dl>
        {displayed.start.parentId && <button className="audit-text-button" type="button" onClick={() => { onSelect(displayed.start.parentId!); setIdInput(displayed.start.parentId!); }}><ArrowUpRight size={14} />{text("parent")}</button>}
        <h3>{text("references")}</h3><ul className="audit-references">{combinedReferences(displayed).map((item) => <li key={`${item.type}:${item.id}:${item.version}`}><div><span>{text(item.type)}</span><code>{item.id}</code>{item.version && <small>v{item.version}</small>}</div><div><button className="icon-button" type="button" title={`${text("viewReference")} ${text(item.type)}`} aria-label={`${text("viewReference")} ${text(item.type)} ${item.id}`} onClick={() => onReference(item)}><ArrowUpRight size={15} /></button>{["approval", "ticket", "document", "source", "connector", "connector_source"].includes(item.type) && <button className="icon-button" type="button" title={text("filterReference")} aria-label={`${text("filterReference")} ${item.id}`} onClick={() => filterChain("", `${item.type}:${item.id}`)}><Link2 size={15} /></button>}</div></li>)}</ul>
        <details className="audit-input"><summary>{text("input")}</summary><dl className="audit-metadata">{displayed.start.input.queryLength !== undefined && <div><dt>{text("queryLength")}</dt><dd>{displayed.start.input.queryLength.toLocaleString(locale)}</dd></div>}{displayed.start.input.contentLength !== undefined && <div><dt>{text("contentLength")}</dt><dd>{displayed.start.input.contentLength.toLocaleString(locale)}</dd></div>}<div><dt>{text("fields")}</dt><dd>{displayed.start.input.fields.join(", ") || text("none")}</dd></div>{displayed.start.input.impact && <div><dt>{text("impact")}</dt><dd>{displayed.start.input.impact}</dd></div>}{displayed.start.input.confirmed !== undefined && <div><dt>{text("confirmed")}</dt><dd>{String(displayed.start.input.confirmed)}</dd></div>}{displayed.start.input.queryHash && <div><dt>{text("queryHash")}</dt><dd><code>{displayed.start.input.queryHash}</code></dd></div>}{displayed.start.input.contentHash && <div><dt>{text("contentHash")}</dt><dd><code>{displayed.start.input.contentHash}</code></dd></div>}</dl></details>
        <h3>{text("executionTrace")}</h3><ol className="audit-trace"><li><code>audit.started</code><time dateTime={displayed.start.startedAt}>{new Date(displayed.start.startedAt).toLocaleTimeString(locale)}</time></li>{displayed.result?.trace.map((step, index) => <li key={`${step.step}-${index}`}><code>{step.step}</code><time dateTime={step.at}>{new Date(step.at).toLocaleTimeString(locale)}</time></li>)}</ol>
        <details className="plugin-json"><summary>{text("original")}</summary><pre>{JSON.stringify(displayed, null, 2)}</pre></details>
      </> : !detailError && <div className="records-empty"><FileClock size={26} /><span>{text(activeId ? "detailLoading" : "noDetail")}</span></div>}</aside></div>
  </div>;
}