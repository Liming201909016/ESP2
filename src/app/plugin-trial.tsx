"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, ExternalLink, Eye, Play, RefreshCw, X } from "lucide-react";
import { z } from "zod";
import { ticketReceiptSchema, type SkillParameters } from "../lib/esp/contracts";
import { pluginInputSchemas, pluginTrialResponseSchema, type PluginCatalogEntry, type PluginTrialResponse } from "../lib/esp/plugin-contracts";
import { useLocale } from "./locale-provider";
import { pluginErrorKey, pluginText, type PluginTextKey } from "../lib/esp/plugin-locale";
import { presentedSkillName } from "../lib/esp/skill-presentation";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { knowledgeMissingMessage, knowledgeVerificationMessage } from "./knowledge-feedback";

export type PluginWritePreview = NonNullable<PluginTrialResponse["preview"]>;
type TrialInput = { query: string; parameters?: SkillParameters };
type PluginOperation = PluginCatalogEntry["operations"][number];

const savedTicketsSchema = z.object({ tickets: z.array(ticketReceiptSchema.extend({ id: z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/) })).max(50) });
export function savedTicketChoices(body: unknown) { return savedTicketsSchema.parse(body).tickets; }

export function SavedTicketPicker({ value, disabled, onChoose, onOpenAudit }: { value: string; disabled: boolean; onChoose: (id: string) => void; onOpenAudit?: (id: string) => void }) {
  const { locale } = useLocale();
  const text = (key: PluginTextKey) => pluginText(locale, key);
  const [tickets, setTickets] = useState<ReturnType<typeof savedTicketChoices> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [audit, setAudit] = useState<AuditReceipt | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    if (pending || disabled) return;
    const active = new AbortController(); controller.current = active;
    setPending(true); setError(false);
    try {
      const response = await fetch("/api/tickets", { cache: "no-store", signal: AbortSignal.any([active.signal, AbortSignal.timeout(45_000)]) });
      const body = await response.json();
      if (active.signal.aborted) return;
      setAudit(readAuditReceipt(body));
      if (!response.ok) throw new Error("SAVED_TICKETS_UNAVAILABLE");
      setTickets(savedTicketChoices(body));
    } catch { if (!active.signal.aborted) { setTickets(null); setError(true); } }
    finally { if (!active.signal.aborted) setPending(false); }
  }
  return <div className="saved-ticket-picker"><button className="refresh-button" type="button" disabled={disabled || pending} onClick={() => void load()}><RefreshCw size={14} />{text(pending ? "loading" : "savedLoad")}</button>{tickets && <label>{text("savedLabel")}<select aria-label={text("savedSelect")} disabled={disabled || pending || !tickets.length} value={tickets.some((ticket) => ticket.id === value) ? value : ""} onChange={(event) => { if (event.target.value) onChoose(event.target.value); }}><option value="">{text(tickets.length ? "chooseTicket" : "noSaved")}</option>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.id} · {ticket.details?.device ?? text("unspecifiedDevice")} · {ticket.summary.slice(0, 65)}</option>)}</select></label>}{error && <p className="draft-error" role="alert">{text("savedFailure")}</p>}<AuditFeedback receipt={audit} onOpen={onOpenAudit} /></div>;
}

class TrialFailure extends Error {
  constructor(public key: PluginTextKey) { super(key); }
}

function TrialResult({ result, pending, onReview, executionPending, audit, onOpenAudit }: {
  result: PluginTrialResponse | null; pending: boolean; onReview: (preview: PluginWritePreview, audit?: AuditReceipt) => void; executionPending: boolean; audit: AuditReceipt | null; onOpenAudit?: (id: string) => void;
}) {
  const { locale, t } = useLocale();
  const text = (key: PluginTextKey) => pluginText(locale, key);
  const execution = result?.execution;
  return (
    <section className="plugin-result" aria-label={text("result")} aria-busy={pending}>
      <h3><Activity size={16} />{text("resultHeading")}</h3>
      <AuditFeedback receipt={audit} onOpen={onOpenAudit} />
      {pending ? <p className="plugin-empty" role="status">{text("running")}</p> : !result ? <p className="plugin-empty">{text("noResult")}</p> : <>
        <div className="plugin-result-state"><span className={`plugin-status ${result.status}`}>{result.error === "KNOWLEDGE_VERIFICATION_FAILED" ? t("verificationFailed") : text(`status_${result.status}`)}</span><span>{text(result.mode === "write_preview" ? "noWrite" : "actualRead")}</span><code>{result.durationMs.toLocaleString(locale)} ms</code></div>
        <dl className="plugin-metadata"><div><dt>{t("requestId")}</dt><dd><code>{result.requestId}</code></dd></div><div><dt>{text("completedAt")}</dt><dd><time dateTime={result.completedAt}>{new Date(result.completedAt).toLocaleString(locale)}</time></dd></div></dl>
        {result.status === "failed" && <div className="error-banner" role="alert">{result.error === "KNOWLEDGE_VERIFICATION_FAILED" ? knowledgeVerificationMessage(result.verificationReason, locale) : result.error === "MODEL_RATE_LIMITED" ? `${t("rateLimited")} ${result.retryAfterSeconds ?? 60}` : text("dependencyFailure")}</div>}
        {execution?.type === "knowledge_answer" && <div className="plugin-answer"><small>{t("answerOriginal")}</small><p>{execution.answer}</p><h4>{t("reviewOriginal")}</h4><ol>{execution.citations.map((citation, index) => <li key={`${citation.id}-${index}`}><a href={citation.url} target="_blank" rel="noreferrer"><span>{citation.documentNumber} · {citation.title}</span><ExternalLink size={13} /></a><blockquote>{citation.excerpt}</blockquote><small>{t(citation.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")} {citation.effectiveDate} · {citation.version}</small></li>)}</ol></div>}
        {execution?.type === "knowledge_not_found" && <p className="plugin-outcome">{knowledgeMissingMessage(execution.reason, locale)}</p>}
        {execution?.type === "input_required" && <p className="plugin-outcome">{t("ticketIdRequired")}</p>}
        {execution?.type === "ticket_details_required" && <p className="plugin-outcome">{text("requiredInput")} {execution.missingFields.map((field) => t(field === "description" ? "ticketDescription" : "ticketImpact")).join(" / ")}</p>}
        {execution?.type === "ticket_not_found" && <p className="plugin-outcome"><code>{execution.ticketId}</code><br />{t("ticketNotFound")}</p>}
        {execution?.type === "ticket_status" && <dl className="plugin-metadata"><div><dt>{t("ticketId")}</dt><dd><code>{execution.ticket.id}</code></dd></div><div><dt>{t("ticketStatus")}</dt><dd>{t("ticketOpen")}</dd></div><div><dt>{t("ticketDescription")}</dt><dd>{execution.ticket.summary}</dd></div><div><dt>{t("createdAt")}</dt><dd>{new Date(execution.ticket.createdAt).toLocaleString(locale)}</dd></div>{execution.ticket.details && <div><dt>{t("ticketImpact")}</dt><dd>{t(`impact_${execution.ticket.details.impact}`)}</dd></div>}</dl>}
        {result.preview && <div className="plugin-write-preview"><h4>{text("preview")}</h4><dl className="plugin-metadata"><div><dt>{t("ticketDescription")}</dt><dd>{result.preview.parameters.description}</dd></div><div><dt>{t("ticketDevice")}</dt><dd>{result.preview.parameters.device || t("unspecified")}</dd></div><div><dt>{t("ticketImpact")}</dt><dd>{t(`impact_${result.preview.parameters.impact}`)}</dd></div></dl><button className="kb-primary" type="button" disabled={executionPending} onClick={() => onReview(result.preview!, audit ?? undefined)}><ArrowUpRight size={15} />{text("review")}</button></div>}
        <details className="plugin-trace"><summary>{t("trace")} · {result.trace.length}</summary><ol>{result.trace.map((step, index) => <li key={`${step.step}-${index}`}><code>{step.step}</code><time dateTime={step.at}>{new Date(step.at).toLocaleTimeString(locale)}</time></li>)}</ol></details>
        <details className="plugin-json"><summary>{text("originalJson")}</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
      </>}
    </section>
  );
}

export function PluginTrialPanel({ plugin, operation, disabled, onReview, executionPending, onOpenAudit }: {
  plugin: PluginCatalogEntry; operation: PluginOperation; disabled: boolean; onReview: (preview: PluginWritePreview, audit?: AuditReceipt) => void; executionPending: boolean; onOpenAudit?: (id: string) => void;
}) {
  const { locale, t } = useLocale();
  const text = (key: PluginTextKey) => pluginText(locale, key);
  const first = operation.examples[0];
  const [skillId, setSkillId] = useState(first?.skillId ?? operation.skills[0].id);
  const [exampleId, setExampleId] = useState(first?.id ?? "");
  const [input, setInput] = useState<TrialInput>(first?.input ?? { query: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PluginTextKey | null>(null);
  const [result, setResult] = useState<PluginTrialResponse | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const [audit, setAudit] = useState<AuditReceipt | null>(null);
  const parentAudit = useRef<AuditReceipt | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  function updateInput(changes: Partial<TrialInput>) {
    setAudit(null); parentAudit.current = null;
    setInput((current) => ({ ...current, ...changes })); setExampleId(""); setResult(null); setError(null);
  }

  function chooseExample(id: string) {
    setAudit(null); parentAudit.current = null;
    const example = operation.examples.find((entry) => entry.id === id);
    setExampleId(id); setResult(null); setError(null);
    if (example) { setSkillId(example.skillId); setInput(example.input); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    const parsedInput = pluginInputSchemas[operation.id].safeParse(input);
    if (!parsedInput.success) { setError("INVALID_REQUEST"); setResult(null); return; }
    const controller = new AbortController();
    activeRequest.current?.abort(); activeRequest.current = controller;
    setPending(true); setResult(null); setError(null);
    try {
      const response = await fetch(`/api/plugins/${plugin.id}/trial`, {
        method: "POST", headers: { "content-type": "application/json", ...auditParentHeaders(parentAudit.current) },
        body: JSON.stringify({ operationId: operation.id, skillId, input: parsedInput.data }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)]),
      });
      const body = await response.json();
      if (!controller.signal.aborted) { const receipt = readAuditReceipt(body); setAudit(receipt); if (receipt?.status === "recorded" || receipt?.status === "incomplete") parentAudit.current = receipt; }
      const parsed = pluginTrialResponseSchema.safeParse(body);
      if (!parsed.success) throw new TrialFailure(pluginErrorKey(body.error));
      if (parsed.data.pluginId !== plugin.id || parsed.data.operationId !== operation.id || parsed.data.skillId !== skillId) throw new TrialFailure("mismatch");
      if (!response.ok && parsed.data.status !== "failed") throw new TrialFailure("invalidStatus");
      if (!controller.signal.aborted) setResult(parsed.data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof TrialFailure ? failure.key : failure instanceof Error && failure.name === "TimeoutError" ? "timeout" : "trialFailure");
    } finally { if (!controller.signal.aborted) setPending(false); }
  }

  const parameters = input.parameters ?? {};
  return (
    <div className="plugin-trial-grid">
      <form className="plugin-input" aria-label={text("input")} onSubmit={submit}>
        <h3>{operation.effect === "write" ? <Eye size={16} /> : <Play size={16} />}{text(operation.effect === "write" ? "write" : "readTrial")}</h3>
        <fieldset disabled={disabled || pending}>
          <label>{text("skills")}<select aria-label={text("boundSkill")} value={skillId} onChange={(event) => {
            const next = event.target.value; const example = operation.examples.find((entry) => entry.skillId === next);
            setAudit(null); parentAudit.current = null;
            setSkillId(next); setExampleId(example?.id ?? ""); setInput(example?.input ?? { query: "" }); setResult(null); setError(null);
          }}>{operation.skills.map((skill) => <option key={skill.id} value={skill.id}>{presentedSkillName(skill, locale)}</option>)}</select></label>
          <small>{text("originals")}</small><label>{text("example")}<select aria-label={text("exampleSelect")} value={exampleId} onChange={(event) => chooseExample(event.target.value)}><option value="">{text("custom")}</option>{operation.examples.filter((example) => example.skillId === skillId).map((example) => <option key={example.id} value={example.id}>{example.title}</option>)}</select></label>
          <label>{t("businessRequest")}<textarea aria-label={text("query")} rows={3} value={input.query} required maxLength={2_000} onChange={(event) => updateInput({ query: event.target.value })} /></label>
          {operation.id === "tickets.get" && <><label>{t("ticketId")}<input aria-label={text("ticketId")} value={parameters.ticketId ?? ""} maxLength={21} autoComplete="off" onChange={(event) => updateInput({ parameters: { ticketId: event.target.value.toUpperCase() || undefined } })} /></label><SavedTicketPicker value={parameters.ticketId ?? ""} disabled={disabled || pending} onOpenAudit={onOpenAudit} onChoose={(id) => updateInput({ query: `查询工单状态 ${id}`, parameters: { ticketId: id } })} /></>}
          {operation.id === "tickets.create" && <>
            <label>{t("ticketDescription")}<textarea aria-label={text("description")} rows={3} maxLength={2_000} value={parameters.description ?? ""} onChange={(event) => updateInput({ parameters: { ...parameters, description: event.target.value } })} /></label>
            <label>{t("ticketDevice")}<input aria-label={text("device")} maxLength={120} value={parameters.device ?? ""} onChange={(event) => updateInput({ parameters: { ...parameters, device: event.target.value } })} /></label>
            <label>{t("ticketImpact")}<select aria-label={text("impact")} value={parameters.impact ?? ""} onChange={(event) => updateInput({ parameters: { ...parameters, impact: event.target.value as SkillParameters["impact"] || undefined } })}><option value="">{t("unspecified")}</option>{(["individual", "team", "organization"] as const).map((value) => <option key={value} value={value}>{t(`impact_${value}`)}</option>)}</select></label>
          </>}
        </fieldset>
        {error && <div className="error-banner" role="alert">{text(error)}</div>}
        <div className="plugin-run-actions"><button className="kb-primary" type="submit" disabled={disabled || pending}>{operation.effect === "write" ? <Eye size={15} /> : <Play size={15} />}{pending ? t("processing") : text(operation.effect === "write" ? "generate" : "runRead")}</button>{pending && <button className="icon-button" type="button" title={text("cancel")} aria-label={text("cancel")} onClick={() => { activeRequest.current?.abort(); setPending(false); setError("cancelled"); }}><X size={17} /></button>}</div>
      </form>
      <TrialResult result={result} pending={pending} onReview={onReview} executionPending={executionPending} audit={audit} onOpenAudit={onOpenAudit} />
    </div>
  );
}