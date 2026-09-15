"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Database, ExternalLink, FilePlus2, Link2, MessageSquare, RotateCcw, Search } from "lucide-react";
import { enterpriseRecordById, enterpriseRecords, enterpriseRecordTypes, filterEnterpriseRecords } from "../lib/esp/enterprise-records";
import { simulationCategories } from "../lib/esp/simulation-cases";
import type { TicketDetails } from "../lib/esp/contracts";
import { demoCategory, demoOriginalLabel, demoRecordType, demoText, type DemoTextKey } from "../lib/esp/demo-locale";
import { useLocale } from "./locale-provider";

export type EnterpriseRecordActions = {
  onQuery: (skillId: string, query: string) => void;
  onPrepare: (query: string, parameters: TicketDetails) => void;
  onOpenRecords: () => void;
  pending: boolean;
};

export function EnterpriseRecordLibrary({ onQuery, onPrepare, onOpenRecords, pending }: EnterpriseRecordActions) {
  const { locale } = useLocale();
  const text = (key: DemoTextKey) => demoText(locale, key);
  const statusLabel = (label: string) => demoOriginalLabel(locale, label === "active" ? "有效样本" : label);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [kind, setKind] = useState("expense");
  const [status, setStatus] = useState("all");
  const [pageNumber, setPageNumber] = useState(0);
  const [selectedId, setSelectedId] = useState("SIM-EXP-202609-0018");
  const [tab, setTab] = useState<"record" | "relations">("record");
  const heading = useRef<HTMLHeadingElement>(null);
  const tableContainer = useRef<HTMLDivElement>(null);
  const records = filterEnterpriseRecords({ query, category, kind, status });
  const pageCount = Math.max(1, Math.ceil(records.length / 12));
  const activePage = Math.min(pageNumber, pageCount - 1);
  const pageRecords = records.slice(activePage * 12, activePage * 12 + 12);
  const selected = pageRecords.find((record) => record.id === selectedId) ?? pageRecords[0];
  useEffect(() => {
    const container = tableContainer.current;
    const row = container?.querySelector("tr.selected");
    if (!container || !row) return;
    const visible = container.getBoundingClientRect(); const selectedRow = row.getBoundingClientRect();
    if (selectedRow.top < visible.top + 40) container.scrollTop += selectedRow.top - visible.top - 40;
    else if (selectedRow.bottom > visible.bottom) container.scrollTop += selectedRow.bottom - visible.bottom;
  }, [selected?.id]);
  const statuses = [...new Map(filterEnterpriseRecords({ query: "", category, kind, status: "all" }).map((record) => [record.status, record.statusLabel === "active" ? "有效样本" : record.statusLabel])).entries()];
  function reset() { setQuery(""); setCategory("all"); setKind("all"); setStatus("all"); setPageNumber(0); }
  function openRelated(id: string) { reset(); setPageNumber(Math.max(0, Math.floor(enterpriseRecords.findIndex((record) => record.id === id) / 12))); setSelectedId(id); setTab("record"); heading.current?.focus(); }
  const tabs = [{ id: "record", label: text("originalDetails") }, { id: "relations", label: `${text("relations")} ${(selected?.relatedIds.length ?? 0).toLocaleString(locale)}` }] as const;

  return <div className="enterprise-records">
    <div className="enterprise-overview" aria-label={text("recordScale")}>{(["employee", "project", "expense", "purchase", "asset", "software", "serviceRequest"] as const).map((type) => <span key={type}><strong>{enterpriseRecords.filter((record) => record.kind === type).length.toLocaleString(locale)}</strong>{demoRecordType(locale, type)}</span>)}</div>
    <div className="case-toolbar enterprise-toolbar">
      <label className="case-search"><Search size={16} /><input type="search" value={query} aria-label={text("searchRecords")} placeholder={text("recordPlaceholder")} onChange={(event) => { setQuery(event.target.value); setPageNumber(0); }} /></label>
      <select aria-label={text("recordCategory")} value={category} onChange={(event) => { setCategory(event.target.value); setKind("all"); setStatus("all"); setPageNumber(0); }}><option value="all">{text("allCategories")}</option>{Object.keys(simulationCategories).map((id) => <option key={id} value={id}>{demoCategory(locale, id as keyof typeof simulationCategories)}</option>)}</select>
      <select aria-label={text("recordKind")} value={kind} onChange={(event) => { setKind(event.target.value); setStatus("all"); setPageNumber(0); }}><option value="all">{text("allKinds")}</option>{Object.keys(enterpriseRecordTypes).filter((id) => enterpriseRecords.some((record) => record.kind === id && (category === "all" || record.category === category))).map((id) => <option key={id} value={id}>{demoRecordType(locale, id as keyof typeof enterpriseRecordTypes)}</option>)}</select>
      <select aria-label={text("recordStatus")} value={status} onChange={(event) => { setStatus(event.target.value); setPageNumber(0); }}><option value="all">{text("allStatuses")}</option>{statuses.map(([id, label]) => <option key={id} value={id}>{statusLabel(label)}</option>)}</select>
      <button className="icon-button" type="button" title={text("resetRecords")} aria-label={text("resetRecords")} onClick={reset}><RotateCcw size={16} /></button><span className="case-count" role="status">{records.length} / {enterpriseRecords.length}</span>
    </div>
    <div className="enterprise-layout"><section aria-label={text("recordList")} className="enterprise-table-wrap"><div ref={tableContainer} className="enterprise-table-scroll"><table className="enterprise-table"><caption className="sr-only">{text("recordCaption")}</caption><thead><tr><th scope="col">{text("recordTitle")}</th><th scope="col">{text("kind")}</th><th scope="col">{text("status")}</th></tr></thead><tbody>{pageRecords.map((record) => <tr key={record.id} className={selected?.id === record.id ? "selected" : ""}><td><button type="button" className="enterprise-select" aria-pressed={selected?.id === record.id} onClick={() => { setSelectedId(record.id); setTab("record"); }}><code>{record.id}</code><span>{record.title.startsWith(`${record.id} / `) ? record.title.slice(record.id.length + 3) : record.title}</span></button></td><td>{demoRecordType(locale, record.kind)}</td><td><span className={`enterprise-status ${record.status}`}>{statusLabel(record.statusLabel)}</span></td></tr>)}</tbody></table></div>{records.length === 0 && <div className="records-empty"><Search size={24} /><span>{text("noRecords")}</span></div>}<div className="enterprise-pagination" aria-label={text("pagination")}><span>{records.length ? activePage * 12 + 1 : 0}-{Math.min((activePage + 1) * 12, records.length)} / {records.length}</span><button type="button" className="icon-button" title={text("previous")} aria-label={text("previous")} disabled={activePage === 0} onClick={() => { setPageNumber(activePage - 1); setTab("record"); }}><ChevronLeft size={16} /></button><span>{activePage + 1} / {pageCount}</span><button type="button" className="icon-button" title={text("next")} aria-label={text("next")} disabled={activePage + 1 === pageCount} onClick={() => { setPageNumber(activePage + 1); setTab("record"); }}><ChevronRight size={16} /></button></div></section>
      <aside className="enterprise-detail" aria-label={text("recordDetail")}>{selected ? <>
        <p className="eyebrow">{selected.id}</p><h2 ref={heading} tabIndex={-1}>{selected.title.startsWith(`${selected.id} / `) ? selected.title.slice(selected.id.length + 3) : selected.title}</h2>
        <div className="enterprise-state-line"><span>{demoRecordType(locale, selected.kind)}</span><span className={`enterprise-status ${selected.status}`}>{statusLabel(selected.statusLabel)}</span><span className="sample-label">{text("synthetic")}</span></div>
        <div className="enterprise-actions"><button className="refresh-button" type="button" disabled={pending} onClick={() => onQuery(selected.skillId, selected.query)}><MessageSquare size={15} /> {text("queryRecord")}</button>{selected.action && <button className="kb-primary" type="button" disabled={pending} onClick={() => onPrepare(selected.action!.query, selected.action!.parameters)}><FilePlus2 size={15} /> {text("prepareTicket")}</button>}<a href={`/knowledge/${selected.sourceId}`} target="_blank" rel="noreferrer" className="enterprise-source">{text("originalSource")} <ExternalLink size={14} /></a></div>
        <div className="catalog-tabs enterprise-tabs" role="tablist" aria-label={text("recordViews")}>{tabs.map((item, index) => <button key={item.id} type="button" id={`enterprise-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls="enterprise-record-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => { const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowRight" ? 1 - index : null; if (next === null) return; event.preventDefault(); setTab(tabs[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }}>{item.label}</button>)}</div>
        <div id="enterprise-record-panel" role="tabpanel" aria-labelledby={`enterprise-tab-${tab}`} tabIndex={0}>{tab === "record" ? <><dl className="enterprise-fields">{selected.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>{selected.sections.map((section) => <section className="enterprise-section" key={section.heading}><h3>{section.heading}</h3><p>{section.content}</p></section>)}{selected.kind === "serviceRequest" && <button className="connector-link" type="button" disabled={pending} onClick={onOpenRecords}><ArrowUpRight size={15} /> {text("actualTickets")}</button>}</> : <ul className="enterprise-relations">{selected.relatedIds.map((id) => { const record = enterpriseRecordById.get(id); return record ? <li key={id}><button type="button" onClick={() => openRelated(id)}><Link2 size={15} /><span><small>{demoRecordType(locale, record.kind)} · {id}</small><strong>{record.title.startsWith(`${id} / `) ? record.title.slice(id.length + 3) : record.title}</strong></span><ArrowUpRight size={15} /></button></li> : null; })}</ul>}</div>
      </> : <div className="records-empty"><Database size={24} /><span>{text("noDetails")}</span></div>}</aside>
    </div>
  </div>;
}