"use client";

import { ArrowUpRight, ExternalLink, GitBranch } from "lucide-react";
import type { KnowledgeAnswerResult } from "../lib/esp/contracts";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import type { ParallelReadResult } from "../lib/esp/parallel-read-contracts";
import { AuditFeedback } from "./audit-feedback";
import { knowledgeMissingMessage, knowledgeVerificationMessage } from "./knowledge-feedback";
import { useLocale } from "./locale-provider";
import { presentedSkillName } from "../lib/esp/skill-presentation";

export function KnowledgeAnswerView({ result, label }: { result: KnowledgeAnswerResult; label?: string }) {
  const { t } = useLocale();
  return <section className="knowledge-answer" aria-label={label ?? t("knowledgeAnswer")}>
    <div className="answer-heading"><h3>{t("retrievedAnswer")}</h3><span className="sample-label">{t("simulation")}</span></div>
    {result.knowledgeBase && <p className="parallel-task-meta"><span>{result.knowledgeBase.name}</span><code>{result.knowledgeBase.indexName}</code></p>}
    <small>{t("answerOriginal")}</small><div className="answer-content">{result.answer}</div>
    <h4>{t("sourceEvidence")}</h4>
    <ol className="citation-list">{result.citations.map((citation, index) => <li key={`${citation.id}-${index}`}>
      <a href={citation.url} target="_blank" rel="noreferrer"><span>{index + 1}. {citation.title}</span><ExternalLink size={14} /></a>
      <small>{citation.section} · {citation.version}</small>
      <small>{citation.documentNumber} · {citation.owner} · {t(citation.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")} {citation.effectiveDate}</small>
      <small>{t("reviewOriginal")}</small><blockquote>{citation.excerpt}</blockquote>
    </li>)}</ol>
  </section>;
}

export function ParallelReadResults({ result, busy, onOpenAudit, onContinue }: {
  result: ParallelReadResult;
  busy: boolean;
  onOpenAudit: (id: string) => void;
  onContinue: (skillId: string, query: string, audit?: AuditReceipt) => void;
}) {
  const { locale, t } = useLocale();
  return <section className="parallel-results" aria-label={t("parallelResults")}>
    <div className="parallel-results-heading"><GitBranch size={17} /><h3>{t("independentResults")}</h3><span>{t("readConcurrency")} {result.concurrency}</span></div>
    {result.tasks.map((task, index) => {
      const execution = task.execution;
      const name = presentedSkillName({ id: task.usage.skillId, name: task.usage.name, version: task.usage.version }, locale);
      const failure = task.error === "KNOWLEDGE_VERIFICATION_FAILED" ? knowledgeVerificationMessage(task.verificationReason, locale)
        : task.error === "MODEL_RATE_LIMITED" ? `${t("rateLimited")} ${task.retryAfterSeconds ?? 60}` : t("readFailed");
      return <section className="parallel-task" key={task.id} aria-label={`${t("task")} ${index + 1}${locale === "zh-CN" ? "：" : ": "}${name}`}>
        <div className="parallel-task-heading"><span className="parallel-task-number">{String(index + 1).padStart(2, "0")}</span><h3>{name}</h3>
          <span className={`decision-state ${task.executionStatus}`}>{task.error === "KNOWLEDGE_VERIFICATION_FAILED" ? t("verificationFailed") : t(`status_${task.executionStatus}`)}</span>
        </div>
        <p className="parallel-task-query">{task.query}</p>
        <p className="parallel-task-meta"><code>{task.usage.plugin?.operationId}</code><span>{(task.durationMs / 1_000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s</span><code>{task.requestId}</code></p>
        {task.error && <div className="error-banner" role="alert">{failure}</div>}
        {execution?.type === "knowledge_answer" && <KnowledgeAnswerView result={execution} label={`${t("knowledgeAnswer")}: ${name}`} />}
        {execution?.type === "knowledge_not_found" && <p className="parallel-task-notice">{knowledgeMissingMessage(execution.reason, locale)}</p>}
        {execution?.type === "input_required" && <p className="parallel-task-notice">{t("ticketIdRequired")}</p>}
        {execution?.type === "ticket_not_found" && <p className="parallel-task-notice">{t("ticketNotFound")} <code>{execution.ticketId}</code></p>}
        {execution?.type === "ticket_status" && <dl className="parallel-ticket">
          <div><dt>{t("ticketId")}</dt><dd>{execution.ticket.id}</dd></div><div><dt>{t("ticketStatus")}</dt><dd>{t("ticketOpen")}</dd></div>
          <div><dt>{t("ticketSummary")}</dt><dd>{execution.ticket.summary}</dd></div><div><dt>{t("createdAt")}</dt><dd>{new Date(execution.ticket.createdAt).toLocaleString(locale)}</dd></div>
          {execution.ticket.details && <div><dt>{t("ticketImpact")}</dt><dd>{t(`impact_${execution.ticket.details.impact}`)}</dd></div>}
        </dl>}
        <AuditFeedback receipt={task.audit} onOpen={onOpenAudit} />
        {task.executionStatus !== "completed" && <button type="button" className="parallel-continue" disabled={busy}
          onClick={() => onContinue(task.usage.skillId, task.query, task.audit.status === "recorded" || task.audit.status === "incomplete" ? task.audit : undefined)}>
          <ArrowUpRight size={15} />{t("handleSeparately")}
        </button>}
      </section>;
    })}
  </section>;
}