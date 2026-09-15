"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, GitBranch, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { z } from "zod";
import { ticketGuidanceWorkflow, workflowCatalogSchema, workflowRequestSchema, workflowResponseSchema, type WorkflowResult, type WorkflowStep } from "../lib/esp/workflow-contracts";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { AuditFeedback } from "./audit-feedback";
import { KnowledgeAnswerView } from "./parallel-results";
import { knowledgeMissingMessage, knowledgeVerificationMessage } from "./knowledge-feedback";
import { useLocale } from "./locale-provider";
import { translate, type Locale, type TranslationKey } from "../lib/esp/locale";

const ticketsSchema = z.object({ tickets: z.array(z.object({ id: z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/), summary: z.string() })) });

export function workflowErrorKey(code: unknown): TranslationKey {
  if (code === "AUTHENTICATION_REQUIRED") return "workflowError_access";
  if (code === "PERMISSION_REQUIRED" || code === "SUBJECT_REQUIRED") return "workflowError_permission";
  if (code === "INVALID_WORKFLOW_REQUEST") return "workflowError_input";
  return "workflowError_result";
}

export function workflowRequestText(locale: Locale, ticketId = "") {
  return locale === "zh-CN"
    ? `请先查询工单${ticketId ? ` ${ticketId}` : ""}，再根据工单背景查询 IT 处理规范。`
    : `Look up the ticket${ticketId ? ` ${ticketId}` : ""}, then find IT handling guidance using its context.`;
}

function stepMessage(step: WorkflowStep, locale: Locale) {
  if (step.status === "skipped") return translate(locale, step.skipReason === "context_too_large" ? "workflowSkippedLarge" : "workflowSkippedUpstream");
  if (step.status === "needs_input") return translate(locale, "ticketIdRequired");
  if (step.status === "not_found") return translate(locale, "ticketNotFound");
  if (step.status === "no_evidence") return knowledgeMissingMessage(step.execution?.type === "knowledge_not_found" ? step.execution.reason : undefined, locale);
  if (step.error === "KNOWLEDGE_VERIFICATION_FAILED") return knowledgeVerificationMessage(step.verificationReason, locale);
  if (step.error === "MODEL_RATE_LIMITED") return `${translate(locale, "workflowRateLimited")} ${step.retryAfterSeconds ?? 60}`;
  if (step.status === "failed") return translate(locale, "readFailed");
  return null;
}

export function WorkflowResults({ result, audit, onOpenAudit }: { result: WorkflowResult; audit: AuditReceipt; onOpenAudit: (id: string) => void }) {
  const { locale, t } = useLocale();
  const invoked = result.steps.filter((step) => step.usage?.invoked).length;
  return <section className="workflow-result" aria-label={t("workflowResults")}>
    <div className="demo-heading"><h2>{t("workflowResult")}</h2><span className={`decision-state ${result.executionStatus}`}>{t(`status_${result.executionStatus}`)}</span></div>
    <p className="workflow-summary">{t("invoked")} {invoked} / 2 · {t("status_completed")} {result.steps.filter((step) => step.status === "completed").length} · {t("status_skipped")} {result.steps.filter((step) => step.status === "skipped").length}</p>
    <p className="parallel-task-meta"><code>{result.requestId}</code><span>{t("workflowVersion")} {result.version}</span></p>
    <AuditFeedback receipt={audit} onOpen={onOpenAudit} />
    {result.steps.map((step, index) => {
      const definition = ticketGuidanceWorkflow.steps[index];
      const message = stepMessage(step, locale);
      return <section className="workflow-step-result" key={step.id} aria-label={`${t("workflowStep")} ${index + 1}`}>
        <div className="parallel-task-heading"><span className="parallel-task-number">{String(index + 1).padStart(2, "0")}</span><h3>{t(index === 0 ? "workflowTicketStep" : "workflowGuidanceStep")}</h3><span className={`decision-state ${step.status}`}>{t(`status_${step.status}`)}</span></div>
        <p className="parallel-task-meta"><code>{definition.skillId}</code><code>{definition.operationId}</code><span>{t(step.usage?.invoked ? "invoked" : "notInvoked")}</span>{step.requestId && <><span>{(step.durationMs / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s</span><code>{step.requestId}</code></>}</p>
        {index === 1 && <p className="workflow-input-origin">{t("workflowContext")}</p>}
        {message && <p className={step.status === "failed" ? "error-banner" : "parallel-task-notice"} role={step.status === "failed" ? "alert" : "status"}>{message}</p>}
        {step.execution?.type === "ticket_status" && <dl className="parallel-ticket"><div><dt>{t("ticketId")}</dt><dd>{step.execution.ticket.id}</dd></div><div><dt>{t("ticketStatus")}</dt><dd>{t("ticketOpen")}</dd></div><div><dt>{t("ticketSummary")}</dt><dd>{step.execution.ticket.summary}</dd></div>{step.execution.ticket.details?.device && <div><dt>{t("ticketDevice")}</dt><dd>{step.execution.ticket.details.device}</dd></div>}</dl>}
        {step.execution?.type === "knowledge_answer" && <KnowledgeAnswerView result={step.execution} label={t("workflowEvidence")} />}
        {step.query && <details className="workflow-input"><summary>{t("workflowInput")}</summary><p>{step.query}</p></details>}
        <AuditFeedback receipt={step.audit} onOpen={onOpenAudit} />
      </section>;
    })}
  </section>;
}

export function WorkflowPanel({ pending, onOpenAudit }: { pending: boolean; onOpenAudit: (id: string) => void }) {
  const { locale, t } = useLocale();
  const [catalog, setCatalog] = useState<z.infer<typeof workflowCatalogSchema> | null>(null);
  const [tickets, setTickets] = useState<z.infer<typeof ticketsSchema>["tickets"]>([]);
  const [ticketError, setTicketError] = useState(false);
  const [query, setQuery] = useState(() => workflowRequestText(locale));
  const [selectedTicket, setSelectedTicket] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [result, setResult] = useState<z.infer<typeof workflowResponseSchema> | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    async function read(path: string) {
      const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok) throw new Error("FLOW_READ_UNAVAILABLE");
      return response.json();
    }
    async function load() {
      const [definitions, records] = await Promise.allSettled([read("/api/workflows").then((value) => workflowCatalogSchema.parse(value)), read("/api/tickets").then((value) => ticketsSchema.parse(value))]);
      if (controller.signal.aborted) return;
      setCatalog(definitions.status === "fulfilled" ? definitions.value : null);
      setTickets(records.status === "fulfilled" ? records.value.tickets : []);
      setTicketError(records.status !== "fulfilled");
      if (definitions.status === "rejected") setError("workflowError_catalog");
      setLoading(false);
    }
    void load(); return () => controller.abort();
  }, [revision]);

  function update(next: string) { setQuery(next); setResult(null); setError(null); }

  async function run() {
    if (loading || running || pending || !catalog?.workflows.length || active.current) return;
    const request = workflowRequestSchema.safeParse({ workflowId: ticketGuidanceWorkflow.id, query });
    if (!request.success) { setError("workflowError_input"); return; }
    const controller = new AbortController(); active.current = controller;
    setRunning(true); setResult(null); setError(null);
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.data), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) });
      const body = await response.json();
      if (controller.signal.aborted) return;
      const parsed = workflowResponseSchema.safeParse(body);
      if (parsed.success && (response.ok || response.status === 502 && parsed.data.workflow.executionStatus === "failed")) setResult(parsed.data);
      else setError(parsed.success ? workflowErrorKey(body.error) : response.ok ? "workflowError_response" : workflowErrorKey(body.error));
    } catch { if (!controller.signal.aborted) setError("workflowError_transport"); }
    finally { if (!controller.signal.aborted) setRunning(false); active.current = null; }
  }

  const busy = pending || loading || running;
  const definition = catalog?.workflows[0];
  return <div className="workflow-panel">
    <div className="demo-heading"><h2><GitBranch size={18} />{definition ? definition.name === ticketGuidanceWorkflow.name ? t("workflowTitle") : definition.name : t("workflowReadOnly")}</h2><button type="button" className="refresh-button" disabled={busy} onClick={() => { setLoading(true); setError(null); setCatalog(null); setResult(null); setRevision((value) => value + 1); }}><RefreshCw size={15} />{t("workflowRefresh")}</button></div>
    {loading && <p role="status">{t("workflowLoading")}</p>}
    {!loading && catalog?.workflows.length === 0 && <p className="parallel-task-notice">{t("workflowNone")}</p>}
    {definition && <>
      <p className="parallel-task-meta"><code>{definition.id}</code><span>{t("workflowReadOnly")} · v{definition.version}</span></p>
      <ol className="workflow-plan" aria-label={t("workflowPlan")}>{definition.steps.map((step, index) => <li key={step.id}><span className="parallel-task-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{step.name === ticketGuidanceWorkflow.steps[index].name ? t(index === 0 ? "workflowTicketStep" : "workflowGuidanceStep") : step.name}</strong><code>{step.skillId} · {step.operationId}</code><span>{t(index === 0 ? "workflowTicketInput" : "workflowPrerequisite")}</span></div>{index === 0 && <ArrowDown className="workflow-arrow" size={18} />}</li>)}</ol>
      <form className="workflow-form" aria-label={t("workflowRequest")} onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <label>{t("workflowUserTickets")}<select aria-label={t("workflowTicket")} value={selectedTicket} disabled={busy} onChange={(event) => { setSelectedTicket(event.target.value); update(workflowRequestText(locale, event.target.value)); }}><option value="">{t("workflowManualId")}</option>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.id}</option>)}</select></label>
        {ticketError && <p className="demo-warning" role="status">{t("workflowTicketsUnavailable")}</p>}
        <label>{t("workflowRequest")}<textarea aria-label={t("workflowRequest")} rows={3} maxLength={2000} value={query} disabled={busy} onChange={(event) => { setSelectedTicket(""); update(event.target.value); }} /></label>
        <button className="case-run" type="submit" disabled={busy || !query.trim()}>{running ? <LoaderCircle size={16} className="skill-usage-spinner" /> : <Play size={16} />}{t(running ? "workflowRunning" : "workflowRun")}</button>
      </form>
    </>}
    {error && <div className="error-banner" role="alert">{t(error)}</div>}
    {running && <p role="status">{t("workflowWaiting")}</p>}
    {result && <WorkflowResults result={result.workflow} audit={result.audit} onOpenAudit={onOpenAudit} />}
  </div>;
}