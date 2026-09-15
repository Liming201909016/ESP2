"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, LoaderCircle, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { demoBlockers, demoCases, demoRequest, demoVersion, loadDemoPreflight, type DemoCase, type DemoPreflight } from "../lib/esp/demo";
import { demoOriginalLabel, demoText, type DemoTextKey } from "../lib/esp/demo-locale";
import { useLocale } from "./locale-provider";

export function DemoPanel({ pending, onRun }: { pending: boolean; onRun: (query: string) => void }) {
  const { locale } = useLocale();
  const text = (key: DemoTextKey) => demoText(locale, key);
  const originalLabel = (original: string) => demoOriginalLabel(locale, original);
  const [selected, setSelected] = useState<DemoCase>(demoCases[0]);
  const [preflight, setPreflight] = useState<DemoPreflight | null>(null);
  const [ticketId, setTicketId] = useState("");
  const [checking, setChecking] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<"failed" | string[] | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!preflight) return;
    const deadline = Math.min(Date.parse(preflight.checkedAt) + 60_000, Date.parse(preflight.readiness?.validUntil ?? preflight.checkedAt));
    const timer = setTimeout(() => setExpired(true), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [preflight]);

  async function inspect(run = false) {
    if (checking || pending) return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setChecking(true); setError(null);
    try {
      const next = await loadDemoPreflight(async (path) => {
        const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(30_000)]) });
        if (!response.ok) throw new Error("PREFLIGHT_READ_FAILED");
        return response.json();
      });
      if (current.signal.aborted) return;
      setPreflight(next); setExpired(false);
      if (!next.tickets.some((ticket) => ticket.id === ticketId)) setTicketId("");
      if (run) {
        const blockers = demoBlockers(selected, next, ticketId);
        if (blockers.length) { setError(blockers); return; }
        onRun(demoRequest(selected.id, selected.requiresTicket ? ticketId : undefined).query);
      }
    } catch {
      if (!current.signal.aborted) { setPreflight(null); setError("failed"); }
    } finally { if (!current.signal.aborted) setChecking(false); }
  }

  const blockers = demoBlockers(selected, preflight, ticketId);
  const busy = pending || checking;
  const query = selected.requiresTicket && !ticketId ? null : demoRequest(selected.id, ticketId || undefined).query;
  const modelConfigured = preflight?.plugins.find((plugin) => plugin.id === "knowledge")?.dependencies.find((dependency) => dependency.id === "foundry")?.configured;
  return <div className="demo-panel">
    <section className="demo-preflight" aria-label={text("preflight")}>
      <div className="demo-heading"><h2><ClipboardCheck size={18} />{text("preflight")}</h2><button className="refresh-button" type="button" disabled={busy} onClick={() => void inspect()}>{checking ? <LoaderCircle size={15} className="skill-usage-spinner" /> : <RefreshCw size={15} />} {text(checking ? "checking" : "inspect")}</button></div>
      <dl className="demo-checks">
        <div><dt>{text("dependencies")}</dt><dd>{text(preflight?.readiness?.status === "ready" ? "ready" : preflight ? "notReady" : "unchecked")}{expired ? ` · ${text("expired")}` : ""}</dd></div>
        {(["blob", "search", "state"] as const).map((id) => <div key={id}><dt>{text(id === "state" ? "database" : id)}</dt><dd>{text(preflight?.readiness ? preflight.readiness.checks[id].status : "unknown")}</dd></div>)}
        <div><dt>{text("model")}</dt><dd>{text(modelConfigured ? "configured" : "unconfirmed")}</dd></div>
        <div><dt>{text("release")}</dt><dd>{preflight?.release ? <code title={preflight.release.releaseId}>{preflight.release.releaseId}</code> : text("noRelease")}</dd></div>
        <div><dt>{text("skills")}</dt><dd>{preflight ? preflight.skills.length.toLocaleString(locale) : "--"}</dd></div>
        <div><dt>{text("tickets")}</dt><dd>{preflight && !preflight.errors.includes("tickets") ? preflight.tickets.length.toLocaleString(locale) : text("unknown")}</dd></div>
        <div><dt>{text("state")}</dt><dd>{preflight?.state ? `${preflight.state.backend} · ${text(preflight.state.writesPaused ? "paused" : "enabled")}` : text("unknown")}</dd></div>
      </dl>
      {preflight && <p className="catalog-updated">{text("checkedAt")} {new Date(preflight.checkedAt).toLocaleTimeString(locale)} · {text("validUntil")} {preflight.readiness ? new Date(Math.min(Date.parse(preflight.checkedAt) + 60_000, Date.parse(preflight.readiness.validUntil))).toLocaleTimeString(locale) : "--"}</p>}
      {!!preflight?.errors.length && <p className="demo-warning" role="status"><TriangleAlert size={16} />{text("unknown")}: {preflight.errors.map((id) => text(id)).join(" / ")}</p>}
    </section>
    <div className="demo-layout">
      <section className="demo-case-list" aria-label={text("cases")}><h2>{text("fixed")} <small>{demoVersion}</small></h2>
        {demoCases.map((entry) => <button className={`demo-case-select${entry.id === selected.id ? " selected" : ""}`} type="button" key={entry.id} aria-pressed={entry.id === selected.id} disabled={busy} onClick={() => { setSelected(entry); setError(null); }}><code>{entry.id}</code><strong>{originalLabel(entry.title)}</strong><span>{text(entry.expected)}</span></button>)}
      </section>
      <section className="demo-case-detail" aria-label={text("detail")}>
        <p className="eyebrow">{selected.id}</p><h2>{originalLabel(selected.title)}</h2>
        {selected.requiresTicket && <label className="demo-ticket">{text("tickets")}<select aria-label={text("ticket")} value={ticketId} disabled={busy || !preflight?.tickets.length} onChange={(event) => { setTicketId(event.target.value); setError(null); }}><option value="">{text("selectTicket")}</option>{preflight?.tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.id}</option>)}</select></label>}
        {ticketId && selected.requiresTicket && <p className="demo-ticket-summary">{preflight?.tickets.find((ticket) => ticket.id === ticketId)?.summary}</p>}
        <h3>{text("request")}</h3><p className="case-question">{query ?? text("awaitingTicket")}</p>
        <dl className="demo-expectations"><div><dt>{text("expected")}</dt><dd>{text(selected.expected)}</dd></div><div><dt>{text("expectedSkills")}</dt><dd>{selected.skills.length ? selected.skills.map((id) => <span key={id}>{id}</span>) : text("noCalls")}</dd></div><div><dt>{text("expectedPlugins")}</dt><dd>{selected.plugins.join(" / ") || text("noCalls")}</dd></div><div><dt>{text("expectedBases")}</dt><dd>{selected.knowledgeBases.map((id) => text(id)).join(" / ") || text("noSearch")}</dd></div></dl>
        {blockers.length || expired ? <ul className="demo-blockers">{[...new Set([...blockers, ...(expired ? ["自检已过期，请重新检查"] : [])])].map((reason) => <li key={reason}>{originalLabel(reason)}</li>)}</ul> : <p className="demo-ready"><CheckCircle2 size={16} />{text("passed")}</p>}
        {error && <div className="error-banner" role="alert">{error === "failed" ? text(error) : error.map(originalLabel).join(" / ")}</div>}
        <button className="case-run" type="button" disabled={busy || !!blockers.length || expired} onClick={() => void inspect(true)}><Play size={16} />{text(checking ? "checking" : "run")}</button>
      </section>
    </div>
  </div>;
}