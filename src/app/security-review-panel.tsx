"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, FileSearch, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { reviewCapabilities, reviewCases, storedSecurityReviewSchema, type StoredSecurityReview } from "../lib/esp/security-review";
import { AuditFeedback, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";
import type { TranslationKey } from "../lib/esp/locale";
import { presentedReviewFinding, translatedReviewEvidence, reviewTranslationVersion } from "../lib/esp/security-review-presentation";

const responseErrors = {
  REVIEW_BLOCKED: "reviewError_REVIEW_BLOCKED", REVIEW_CONFLICT: "reviewError_REVIEW_CONFLICT",
  REVIEW_FINALIZED: "reviewError_REVIEW_FINALIZED", STATE_WRITES_PAUSED: "reviewError_STATE_WRITES_PAUSED",
  REVIEW_SCOPE_UNSUPPORTED: "reviewError_REVIEW_SCOPE_UNSUPPORTED",
} as const satisfies Record<string, TranslationKey>;
export function SecurityReviewPanel({ onOpenAudit, initialId, initialQuery }: { onOpenAudit: (id: string) => void; initialId?: string | null; initialQuery?: string }) {
  const { locale, t } = useLocale();
  const [query, setQuery] = useState(() => initialQuery ?? t("reviewDefaultQuery"));
  const [caseId, setCaseId] = useState<(typeof reviewCases)[number]["id"]>("missing");
  const [discovered, setDiscovered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<StoredSecurityReview[]>([]);
  const [selected, setSelected] = useState<StoredSecurityReview | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<{ id: string; etag: string; text: string } | null>(null);
  const reason = selected && decisionDraft?.id === selected.record.id && decisionDraft.etag === selected.etag ? decisionDraft.text : "";
  const [previousReviewId, setPreviousReviewId] = useState<string | null>(null);
  const [pending, setPending] = useState(false); const [error, setError] = useState<TranslationKey | null>(null);
  const [backend, setBackend] = useState<"memory" | "blob" | null>(null); const [cursor, setCursor] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditReceipt | null>(null);
  const [localAudit, setLocalAudit] = useState<string | null>(null);
  const submission = useRef<string | null>(null); const busy = useRef(false);
  const requestForm = useRef<HTMLFormElement | null>(null);
  const detailRevision = useRef(0);
  const listRequest = useRef<AbortController | null>(null);
  const [listLoading, setListLoading] = useState(false);
  async function load(next?: string, signal?: AbortSignal) {
    if (signal?.aborted || next && listRequest.current) return;
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller;
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    setListLoading(true);
    try {
      const response = await fetch(`/api/security-reviews${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, { cache: "no-store", signal: requestSignal });
      if (!response.ok) throw new Error("LOAD");
      const value = await response.json(); const entries = storedSecurityReviewSchema.array().parse(value.records);
      if (requestSignal.aborted || listRequest.current !== controller) return;
      setRecords((current) => [...new Map((next ? [...current, ...entries] : entries).map((entry) => [entry.record.id, entry])).values()]);
      setCursor(typeof value.nextCursor === "string" && value.nextCursor ? value.nextCursor : null);
    } catch {
      if (!controller.signal.aborted && !signal?.aborted && listRequest.current === controller) setError("reviewError_LOAD");
    } finally {
      if (listRequest.current === controller) { listRequest.current = null; setListLoading(false); }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const revision = ++detailRevision.current;
    void (async () => {
      try {
        const response = await fetch("/api/security-reviews?catalog=true", { signal: controller.signal });
        if (!response.ok) { setError("reviewError_ACCESS"); return; }
        const catalog = await response.json();
        if (controller.signal.aborted) return;
        setBackend(catalog.backend === "memory" ? "memory" : catalog.backend === "blob" ? "blob" : null);
        await load(undefined, controller.signal);
        if (initialId && !controller.signal.aborted && revision === detailRevision.current) {
          const detail = await fetch(`/api/security-reviews?id=${encodeURIComponent(initialId)}`, { signal: controller.signal });
          if (!detail.ok) throw new Error("LOAD");
          const body = await detail.json();
          if (controller.signal.aborted || revision !== detailRevision.current) return;
          setSelected(storedSecurityReviewSchema.parse({ record: body.record, etag: body.etag })); setDecisionDraft(null); setAudit(null);
        }
      } catch { if (!controller.signal.aborted && revision === detailRevision.current) setError("reviewError_LOAD"); }
      finally { if (!controller.signal.aborted) { setLoading(false); if (!listRequest.current) setListLoading(false); } }
    })();
    return () => { controller.abort(); detailRevision.current += 1; listRequest.current?.abort(); listRequest.current = null; };
  }, [initialId]);
  async function action(command: Record<string, unknown>) {
    if (busy.current) return; busy.current = true; setPending(true); setError(null);
    const revision = ++detailRevision.current;
    try {
      const response = await fetch("/api/security-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const body = await response.json();
      if (revision !== detailRevision.current) return;
      setAudit(readAuditReceipt(body));
      if (!response.ok) { setError(Object.hasOwn(responseErrors, body.error) ? responseErrors[body.error as keyof typeof responseErrors] : "reviewError_UNCERTAIN"); return; }
      if (command.action === "discover") { setDiscovered(Boolean(body.discovery)); if (!body.discovery) setError("reviewError_NOT_DISCOVERED"); return; }
      const entry = storedSecurityReviewSchema.parse({ record: body.reviewRecord, etag: body.etag });
      setSelected(entry); setDecisionDraft(null); await load();
    } catch { if (revision === detailRevision.current) setError("reviewError_UNCERTAIN"); }
    finally { busy.current = false; setPending(false); }
  }
  async function open(id: string) {
    if (busy.current) return; busy.current = true; setPending(true); setError(null);
    const revision = ++detailRevision.current;
    setDecisionDraft(null);
    try {
      const response = await fetch(`/api/security-reviews?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("LOAD");
      const body = await response.json();
      if (revision !== detailRevision.current) return;
      setSelected(storedSecurityReviewSchema.parse({ record: body.record, etag: body.etag })); setAudit(null);
    } catch { if (revision === detailRevision.current) setError("reviewError_LOAD"); }
    finally { busy.current = false; setPending(false); }
  }
  function download() {
    if (!selected) return;
    const link = document.createElement("a"); link.href = `/api/security-reviews?id=${encodeURIComponent(selected.record.id)}&download=true`; link.download = `${selected.record.id}.json`; link.click();
  }
  return <>
    <section className="workspace-heading"><div><p className="eyebrow">SECURITY REVIEW</p><h1>{t("reviewTitle")}</h1></div><ShieldCheck size={26} /></section>
    <p className="catalog-updated">Docker Desktop · SIM-SW-202609-0031 · {t("reviewScope")} · {t(backend === "memory" ? "reviewMemory" : backend === "blob" ? "reviewBlob" : "unknown")}</p>
    <form ref={requestForm} className="security-review-request" onSubmit={(event) => { event.preventDefault(); void action({ action: "discover", query }); }}>
      <label htmlFor="security-intent">{t("reviewQuery")}</label>
      <div className="security-review-command"><input id="security-intent" value={query} maxLength={2000} disabled={pending} onChange={(event) => { setQuery(event.target.value); setDiscovered(false); submission.current = null; }} /><button className="refresh-button" disabled={pending || query.trim().length < 3}><Search size={16} />{t("reviewDiscover")}</button></div>
      <label htmlFor="security-case">{t("reviewCase")}</label><select id="security-case" value={caseId} disabled={pending} onChange={(event) => { setCaseId(event.target.value as typeof caseId); submission.current = null; }}>{reviewCases.map((entry) => <option key={entry.id} value={entry.id}>{t(`reviewCase_${entry.id}`)}</option>)}</select>
      {previousReviewId && <p>{t("reviewLinked")}: {previousReviewId} <button type="button" disabled={pending} onClick={() => { setPreviousReviewId(null); submission.current = null; }}>{t("reviewUnlink")}</button></p>}
      {discovered && <div className="security-review-plan"><ol>{reviewCapabilities.map((entry) => <li key={entry.id}><strong>{t(`reviewSkill_${entry.id}`)}</strong><span>{entry.id} · {entry.version}</span><code>{entry.operationId}</code></li>)}</ol><button type="button" className="refresh-button" disabled={pending} onClick={() => { submission.current ??= crypto.randomUUID(); void action({ action: "start", query, caseId, submissionId: submission.current, previousReviewId }); }}><FileSearch size={16} />{t("reviewCreate")}</button><button type="button" className="refresh-button" disabled={pending} onClick={() => { detailRevision.current += 1; submission.current = null; setSelected(null); setDecisionDraft(null); setPreviousReviewId(null); }}>{t("reviewAnother")}</button></div>}
    </form>
    {error && <p className="error-banner" role="alert">{t(error)}</p>}
    {(pending || loading || listLoading) && <p role="status">{t(pending ? "reviewWorking" : "reviewLoading")}</p>}
    <AuditFeedback receipt={audit} onOpen={(id) => { if (backend === "memory") void fetch(`/api/security-reviews?auditId=${encodeURIComponent(id)}`).then(async (response) => { if (!response.ok) throw new Error(); setLocalAudit(JSON.stringify(await response.json(), null, 2)); }).catch(() => setError("reviewError_AUDIT")); else onOpenAudit(id); }} />
    {localAudit && <details open><summary>{t("reviewLocalAudit")}</summary><pre className="security-review-audit">{localAudit}</pre></details>}
    <section className="security-review-layout">
      <aside className="security-review-list"><div className="section-title"><h2>{t("reviewHistory")}</h2><button className="refresh-button" title={t("reviewRefresh")} aria-label={t("reviewRefresh")} disabled={pending || loading || listLoading} onClick={() => { setError(null); void load(); }}><RefreshCw size={16} /></button></div>{records.map((entry) => <button type="button" key={entry.record.id} className={entry.record.id === selected?.record.id ? "selected" : ""} disabled={pending} onClick={() => void open(entry.record.id)}><strong>{t(`reviewCase_${entry.record.caseId}`)} · {t(`reviewStatus_${entry.record.status}`)}</strong><span>{entry.record.id}</span><time dateTime={entry.record.createdAt}>{new Date(entry.record.createdAt).toLocaleString(locale)}</time></button>)}{!records.length && !loading && !listLoading && !error && <p>{t("reviewEmpty")}</p>}{cursor && <button className="refresh-button" disabled={pending || loading || listLoading} onClick={() => { setError(null); void load(cursor); }}>{t("reviewMore")}</button>}</aside>
      <div className="security-review-detail">{selected ? <>
        <div className="section-title"><div><h2>{t(`reviewStatus_${selected.record.status}`)}</h2><p>{selected.record.id}</p></div></div>
        <div className="security-review-command">
          <a className="refresh-button" href={`/api/security-reviews?id=${encodeURIComponent(selected.record.id)}&format=html&locale=${locale}`} target="_blank" rel="noopener noreferrer"><FileSearch size={16} />{t("reviewViewReport")}</a>
          <a className="refresh-button" href={`/api/security-reviews?id=${encodeURIComponent(selected.record.id)}&format=html&locale=${locale}&download=true`} download><Download size={16} />{t("reviewDownloadHtml")}</a>
          <button className="refresh-button" onClick={download}><Download size={16} />{t("reviewExport")}</button>
        </div>
        <p>{t("reviewPolicy")} SIM-SOFTWARE-SECURITY-CONTROLS · {selected.record.policyVersion} · {t(selected.record.evaluation.controlsPassed ? selected.record.status === "awaiting_decision" ? "reviewChecksAwaiting" : "reviewChecksDecided" : "reviewChecksBlocked")}</p>
        {selected.record.previousReviewId && <button className="refresh-button" onClick={() => void open(selected.record.previousReviewId!)}>{t("reviewPrevious")}</button>}
        <h3>{t("reviewFindings")}</h3>{selected.record.findings.map((original) => {
          const finding = presentedReviewFinding(original, selected.record.policyVersion, locale);
          return <article key={finding.controlId} className="security-review-finding"><header><strong>{finding.title}</strong><span data-status={finding.status}>{t(`reviewFinding_${finding.status}`)}</span></header><p>{finding.requirement}</p><p>{finding.status === "pass" ? t("reviewRetain") : finding.recommendation}</p>{finding.evidenceIds.map((id) => {
            const evidence = selected.record.evidence.find((entry) => entry.id === id)!;
            const translated = translatedReviewEvidence(evidence, selected.record.policyVersion);
            return <blockquote key={id}>{locale === "en-US" && <><small>{translated ? `${t("reviewTranslation")}${reviewTranslationVersion}` : t("reviewTranslationUnavailable")}</small>{translated && <p lang="en-US">{translated}</p>}</>}<small>{t("reviewOriginal")}</small><p lang="zh-CN">{evidence.excerpt}</p><cite>{evidence.documentNumber} · v{evidence.version} · {id}</cite></blockquote>;
          })}</article>;
        })}
        <h3>{t("reviewDecision")}</h3>{selected.record.status === "awaiting_decision" ? <div className="security-review-decision"><label htmlFor="security-reason">{t("reviewReason")}</label><textarea id="security-reason" value={reason} maxLength={1000} disabled={pending} onChange={(event) => setDecisionDraft({ id: selected.record.id, etag: selected.etag, text: event.target.value })} /><div className="security-review-command">{([{ action: "approve", label: "reviewApprove", icon: Check }, { action: "reject", label: "reviewReject", icon: X }, { action: "request_information", label: "reviewRequestInformation", icon: FileSearch }] as const).map(({ action: decision, label, icon: Icon }) => <button className="refresh-button" key={decision} disabled={pending || reason.trim().length < 3 || decision === "approve" && !selected.record.evaluation.controlsPassed} onClick={() => void action({ action: decision, id: selected.record.id, etag: selected.etag, reason })}><Icon size={16} />{t(label)}</button>)}</div></div> : <p>{t("reviewDecisionRecorded")}</p>}
        {selected.record.status === "needs_information" && <button className="refresh-button" onClick={() => {
          setPreviousReviewId(selected.record.id); setDiscovered(true); submission.current = null; setCaseId("complete");
          requestForm.current?.scrollIntoView({ block: "start" });
          requestForm.current?.querySelector("select")?.focus({ preventScroll: true });
        }}><FileSearch size={16} />{t("reviewResubmit")}</button>}
        <h3>{t("reviewExecutionHistory")}</h3><ul className="security-review-history">{selected.record.stages.map((stage) => <li key={stage.skillId}>{stage.skillId} · {stage.version} · {stage.operationId} · {t("reviewCompleted")}</li>)}{selected.record.history.map((event, index) => <li key={index}><strong>{t(`reviewStatus_${event.action}`)}</strong> · <time dateTime={event.at}>{new Date(event.at).toLocaleString(locale)}</time> · {event.actor}<p><small>{t("reviewOriginalReason")}: </small>{event.reason}</p><code>{event.requestId}</code></li>)}</ul>
      </> : <div className="records-empty"><FileSearch size={24} /><span>{t("reviewSelect")}</span></div>}</div>
    </section>
  </>;
}