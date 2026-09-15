"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileClock, Play, RefreshCw, RotateCcw, Search, ShieldCheck, TicketCheck, X } from "lucide-react";
import { approvalDetailSchema, approvalListSchema, approvalSummarySchema, policiesResponseSchema, type ApprovalAction, type ApprovalDetail, type ApprovalList, type ApprovalRecord, type PoliciesResponse } from "../lib/esp/approval-contracts";
import type { TicketDetails } from "../lib/esp/contracts";
import { useLocale } from "./locale-provider";
import { translate, type Locale } from "../lib/esp/locale";
import { ticketApprovalPolicy } from "../lib/esp/approval-policy";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt } from "../lib/esp/audit-contracts";

export const approvalStatusLabels: Record<ApprovalRecord["status"], string> = {
  pending: "待审批", approved: "已通过，待执行", rejected: "已驳回", cancelled: "已撤回", expired: "已过期",
  executing: "执行中", completed: "已完成", execution_unknown: "结果待核对",
};
const actionIcons = { approve: Check, reject: X, cancel: RotateCcw, execute: Play, reconcile: RefreshCw };

export function approvalMessage(code: unknown, locale: Locale = "zh-CN") {
  const english: Record<string, string> = {
    STATE_WRITES_PAUSED: "State maintenance is in progress; no ticket or approval was changed. Refresh later.",
    POSTGRES_COMMIT_UNCERTAIN: "The database commit is unconfirmed. Refresh the approval and reconcile its receipt; do not create another ticket.",
    AUDIT_START_FAILED: "The audit start record was not saved; no approval operation was executed.",
    CONFLICT: "Another operation changed this record. Refresh and verify it again.",
    SUBMISSION_CONFLICT: "This submission ID was used for different input. Generate a new confirmation preview.",
    APPROVAL_EXPIRED: "Approval expired; ticket creation was not executed.",
    INVALID_TRANSITION: "This operation is not allowed in the current state. Refresh the record.",
    EXECUTION_BUSY: "Execution is not complete. Reconciliation is available after an interruption lasting over two minutes.",
    DEV_REVIEW_REQUIRED: "Synthetic approval requires explicit shared-identity DEV mode.",
    NOT_FOUND: "No approval was found for the current identity.",
    PERMISSION_REQUIRED: "The current identity cannot perform this approval operation.",
    AUTHENTICATION_REQUIRED: "This request requires sign-in.",
    POLICY_CHANGED: "The policy version changed. Submit a new approval request.",
    APPROVAL_INPUT_CHANGED: "The approval input differs from the stored snapshot; execution was blocked.",
    APPROVAL_TICKET_CONFLICT: "The ticket ID belongs to different content; the existing record was not overwritten.",
    INVALID_REQUEST: "The approval operation or reason is invalid.",
    EXECUTION_UNCERTAIN: "Execution is unconfirmed. Reconcile the receipt first; an explicit retry uses the same ticket ID.",
    INVALID_RESPONSE: "The approval service returned an invalid state. Refresh to verify the outcome.",
    REQUEST_TIMEOUT: "No response was received. Refresh the record before deciding what to do next.",
  };
  const messages: Record<string, string> = {
    STATE_WRITES_PAUSED: "事务状态维护中，本次未更改工单或审批，请稍后刷新。",
    POSTGRES_COMMIT_UNCERTAIN: "数据库提交结果尚未确认，请刷新审批核对回执，不要另建工单。",
    AUDIT_START_FAILED: "审计开始记录未保存，本次未执行审批操作。",
    CONFLICT: "记录已被其他操作更新，请刷新并重新核对。", SUBMISSION_CONFLICT: "此次提交编号已用于其他输入，请重新生成确认单。",
    APPROVAL_EXPIRED: "审批已过期，未执行工单创建。", INVALID_TRANSITION: "当前状态不允许此操作，请刷新记录。",
    EXECUTION_BUSY: "执行尚未完成；中断超过两分钟后可核对回执。", DEV_REVIEW_REQUIRED: "模拟审批仅在显式 DEV 共享身份模式开放。",
    NOT_FOUND: "当前身份下未找到此审批。", PERMISSION_REQUIRED: "当前身份没有此审批操作权限。", AUTHENTICATION_REQUIRED: "当前请求需要登录。",
    POLICY_CHANGED: "策略版本已变化，请重新提交审批。", APPROVAL_INPUT_CHANGED: "审批输入与保存的快照不一致，已阻止执行。",
    APPROVAL_TICKET_CONFLICT: "工单编号对应的内容与此次审批不一致，未覆盖现有记录。", INVALID_REQUEST: "审批操作或意见格式不符合要求。",
    EXECUTION_UNCERTAIN: "执行结果尚未确认。可先核对回执；显式重试将使用同一工单编号。",
    INVALID_RESPONSE: "审批服务返回了无效状态，请刷新核对。",
    REQUEST_TIMEOUT: "请求未返回，先刷新记录核对执行结果。",
  };
  const dictionary = locale === "en-US" ? english : messages;
  return typeof code === "string" && Object.hasOwn(dictionary, code) ? dictionary[code] : locale === "en-US" ? "The approval outcome is unavailable or unconfirmed. Refresh the record to check its state." : "审批服务暂不可用，请刷新记录核对状态。";
}

class ApprovalFailure extends Error {}
function failureCode(failure: unknown) { return failure instanceof ApprovalFailure ? failure.message : failure instanceof Error && failure.name === "TimeoutError" ? "REQUEST_TIMEOUT" : "UNAVAILABLE"; }

export function approvalDisplayId(id: string) { return `APR-${id.slice(-8).toUpperCase()}`; }
export function approvalPolicyReason(policy: { policyId: string; version: string; ruleId: string; reason: string }, locale: Locale) {
  const rule = ticketApprovalPolicy.rules.find((entry) => entry.id === policy.ruleId && entry.reason === policy.reason);
  return rule && policy.policyId === ticketApprovalPolicy.id && policy.version === ticketApprovalPolicy.version
    ? translate(locale, `ticketPolicy_${rule.impact}`) : policy.reason;
}
function summaryFrom(detail: ApprovalDetail) {
  return approvalSummarySchema.parse({ ...detail.record, description: detail.record.parameters.description, impact: detail.record.parameters.impact, ticketId: detail.record.ticket?.id });
}

export function PolicyApprovalsView({ selectedId, onSelect, onPrepare, onQueryTicket, executionPending, initialAudit, onOpenAudit }: {
  selectedId: string | null; onSelect: (id: string | null) => void; onPrepare: (query: string, parameters: TicketDetails) => void; onQueryTicket: (id: string, audit?: AuditReceipt) => void; executionPending: boolean; initialAudit?: AuditReceipt | null; onOpenAudit?: (id: string) => void;
}) {
  const { locale, t } = useLocale();
  const [policies, setPolicies] = useState<PoliciesResponse | null>(null);
  const [queue, setQueue] = useState<ApprovalList | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [confirmation, setConfirmation] = useState<{ id: string; action: ApprovalAction["action"] } | null>(null);
  const [reason, setReason] = useState("");
  const auditHistory = useRef(new Map<string, AuditReceipt>(selectedId && initialAudit ? [[selectedId, initialAudit]] : []));

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
        const [policyResponse, queueResponse] = await Promise.all([fetch("/api/policies", { cache: "no-store", signal }), fetch("/api/approvals", { cache: "no-store", signal })]);
        const policyBody = await policyResponse.json();
        if (policyResponse.ok && !controller.signal.aborted) setPolicies(policiesResponseSchema.parse(policyBody));
        const queueBody = await queueResponse.json();
        if (!queueResponse.ok) throw new ApprovalFailure(typeof queueBody.error === "string" ? queueBody.error : "UNAVAILABLE");
        const parsed = approvalListSchema.parse(queueBody);
        if (!controller.signal.aborted) setQueue(parsed);
      } catch (failure) { if (!controller.signal.aborted) { setQueue(null); setError(failureCode(failure)); } }
      finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load(); return () => controller.abort();
  }, [revision]);

  const search = query.trim().toLocaleLowerCase();
  const visible = (queue?.approvals ?? []).filter((item) => (status === "all" || item.status === status) && `${item.id} ${item.description} ${item.ticketId ?? ""}`.toLocaleLowerCase().includes(search));
  const activeId = selectedId ?? visible[0]?.id;
  const displayed = detail?.record.id === activeId ? detail : null;
  const confirmedAction = confirmation && confirmation.id === activeId ? confirmation.action : null;

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/approvals/${activeId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json();
        if (!response.ok) throw new ApprovalFailure(typeof body.error === "string" ? body.error : "UNAVAILABLE");
        const parsed = approvalDetailSchema.parse(body);
        if (!controller.signal.aborted) {
          setDetail({ ...parsed, audit: auditHistory.current.get(parsed.record.id) }); setDetailError(null);
          setQueue((current) => current ? { ...current, approvals: current.approvals.some((item) => item.id === parsed.record.id) ? current.approvals.map((item) => item.id === parsed.record.id ? summaryFrom(parsed) : item) : [summaryFrom(parsed), ...current.approvals] } : current);
        }
      } catch (failure) { if (!controller.signal.aborted) { setDetail(null); setDetailError(failureCode(failure)); } }
    }
    void load(); return () => controller.abort();
  }, [activeId, revision]);

  function refresh() {
    setPending(true); setError(null); setDetail(null); setDetailError(null); setConfirmation(null); setRevision((value) => value + 1);
  }

  async function loadMore() {
    if (!queue?.nextCursor || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/approvals?${new URLSearchParams({ cursor: queue.nextCursor })}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body = await response.json(); if (!response.ok) throw new ApprovalFailure(typeof body.error === "string" ? body.error : "UNAVAILABLE");
      const page = approvalListSchema.parse(body);
      setQueue((current) => ({ ...page, approvals: [...new Map([...(current?.approvals ?? []), ...page.approvals].map((item) => [item.id, item])).values()] }));
    } catch (failure) { setError(failureCode(failure)); }
    finally { setBusy(false); }
  }

  async function applyAction() {
    if (!displayed || !confirmedAction || busy) return;
    setBusy(true); setDetailError(null);
    try {
      const response = await fetch(`/api/approvals/${displayed.record.id}`, {
        method: "POST", headers: { "content-type": "application/json", ...auditParentHeaders(auditHistory.current.get(displayed.record.id)) }, body: JSON.stringify({ action: confirmedAction, etag: displayed.etag, ...(reason.trim() ? { reason: reason.trim() } : {}) }), signal: AbortSignal.timeout(65_000),
      });
      const body = await response.json(); const parsed = approvalDetailSchema.safeParse(body);
      const audit = readAuditReceipt(body);
      if (audit) {
        if (audit.status === "recorded" || audit.status === "incomplete") auditHistory.current.set(displayed.record.id, audit);
        setDetail((current) => current?.record.id === displayed.record.id ? { ...current, audit } : current);
      }
      if (parsed.success) {
        setDetail(parsed.data); setQueue((current) => current ? { ...current, approvals: current.approvals.map((item) => item.id === parsed.data.record.id ? summaryFrom(parsed.data) : item) } : current);
      }
      if (!response.ok) { const code = parsed.success ? parsed.data.record.failureCode : body.error; throw new ApprovalFailure(typeof code === "string" ? code : "UNAVAILABLE"); }
      if (!parsed.success) throw new ApprovalFailure("INVALID_RESPONSE");
    } catch (failure) { setDetailError(failureCode(failure)); }
    finally { setBusy(false); setConfirmation(null); setReason(""); }
  }

  return (
    <div className="approval-page">
      <section className="workspace-heading"><div><p className="eyebrow">POLICY & APPROVALS</p><h1>{t("approvals")}</h1></div><button className="refresh-button" type="button" disabled={pending || busy} onClick={refresh}><RefreshCw size={15} />{t(pending ? "loading" : "approvalRefresh")}</button></section>
      <div className="approval-mode"><span>{t("approvalMode")}</span><span>{t(queue?.canReview ? "approvalEnabled" : "approvalDisabled")}</span><span>{t("loaded")} {queue?.approvals.length ?? 0}{queue?.nextCursor ? ` · ${t("moreAvailable")}` : ""}</span></div>
      {policies?.policies.map((policy) => <section className="approval-policy" key={policy.id} aria-label={t("approvalPolicy")}><header><h2>{policy.id === ticketApprovalPolicy.id && policy.version === ticketApprovalPolicy.version && policy.name === ticketApprovalPolicy.name ? t("ticketPolicyName") : policy.name}</h2><span>v{policy.version} · {t("validityHours")} {policy.expiresInHours}</span></header><table><thead><tr><th scope="col">{t("ticketImpact")}</th><th scope="col">{t("executionRequirements")}</th><th scope="col">{t("syntheticRequest")}</th></tr></thead><tbody>{policy.rules.map((rule) => <tr key={rule.id}><td>{t(`impact_${rule.impact}`)}</td><td>{approvalPolicyReason({ policyId: policy.id, version: policy.version, ruleId: rule.id, reason: rule.reason }, locale)}<details><summary>{t("originalPolicy")}</summary><p>{rule.reason}</p></details></td><td><button className="icon-button" type="button" title={`${t("approvalTry")}: ${t(`impact_${rule.impact}`)}`} aria-label={`${t("approvalTry")}: ${t(`impact_${rule.impact}`)}`} disabled={executionPending || busy} onClick={() => onPrepare(t("approvalDemoQuery"), { description: `${t("approvalDemoDescription")} ${t(`impact_${rule.impact}`)}`, impact: rule.impact, device: "SIM-VPN-APPROVAL" })}><Play size={16} /></button></td></tr>)}</tbody></table></section>)}
      <div className="case-toolbar approval-toolbar"><label className="case-search"><Search size={16} /><input aria-label={t("approvalSearch")} type="search" value={query} disabled={busy} placeholder={t("approvalSearchHint")} onChange={(event) => { setQuery(event.target.value); onSelect(null); setConfirmation(null); }} /></label><select aria-label={t("approvalFilter")} value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); onSelect(null); setConfirmation(null); }}><option value="all">{t("allStatuses")}</option>{(Object.keys(approvalStatusLabels) as ApprovalRecord["status"][]).map((value) => <option value={value} key={value}>{t(`approvalStatus_${value}`)}</option>)}</select><span className="case-count" role="status">{visible.length.toLocaleString(locale)}</span></div>
      {error && <div className="error-banner" role="alert">{approvalMessage(error, locale)}</div>}
      {pending && <p className="catalog-loading" role="status">{t("approvalLoading")}</p>}
      <div className="approval-layout">
        <section className="approval-list" aria-label={t("approvalQueue")}><table className="approval-table"><caption className="sr-only">{t("approvalRequests")}</caption><thead><tr><th scope="col">{t("request")}</th><th scope="col">{t("ticketStatus")}</th><th scope="col">{t("submittedAt")}</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className={activeId === item.id ? "selected" : ""}><td><button className="approval-select" type="button" disabled={busy} aria-pressed={activeId === item.id} onClick={() => { onSelect(item.id); setConfirmation(null); setDetailError(null); }}><strong>{item.description}</strong><small>{approvalDisplayId(item.id)} · {t(`impact_${item.impact}`)}</small></button></td><td><span className={`approval-status ${item.status}`}>{t(`approvalStatus_${item.status}`)}</span></td><td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale)}<br />{new Date(item.createdAt).toLocaleTimeString(locale)}</time></td></tr>)}</tbody></table>{!pending && !error && !visible.length && <div className="records-empty"><ShieldCheck size={26} /><span>{t("approvalEmpty")}</span></div>}{queue?.nextCursor && <button className="refresh-button approval-more" type="button" disabled={busy || pending} onClick={() => void loadMore()}>{t("approvalMore")}</button>}</section>
        <aside className="approval-detail" aria-label={t("approvalDetail")}>
          {detailError && <div className="error-banner" role="alert">{approvalMessage(detailError, locale)}</div>}
          <AuditFeedback receipt={displayed?.audit} onOpen={onOpenAudit} />
          {displayed ? <>
            <p className="eyebrow">{approvalDisplayId(displayed.record.id)}</p><h2>{displayed.record.parameters.description}</h2><div className="approval-badges"><span className={`approval-status ${displayed.record.status}`}>{t(`approvalStatus_${displayed.record.status}`)}</span><span>{t("approvalSynthetic")}</span></div>
            <dl className="approval-metadata"><div><dt>{t("submittedBy")}</dt><dd><code>{displayed.record.createdBy}</code></dd></div><div><dt>{t("ticketImpact")}</dt><dd>{t(`impact_${displayed.record.parameters.impact}`)}</dd></div><div><dt>{t("ticketDevice")}</dt><dd>{displayed.record.parameters.device || t("unspecified")}</dd></div><div><dt>{t("policyVersion")}</dt><dd>{displayed.record.policy.policyId}<code>{displayed.record.policy.version} · {displayed.record.policy.ruleId}</code></dd></div><div><dt>{t("approvalExpires")}</dt><dd><time dateTime={displayed.record.expiresAt}>{new Date(displayed.record.expiresAt).toLocaleString(locale)}</time></dd></div></dl>
            <p>{approvalPolicyReason(displayed.record.policy, locale)}</p><details><summary>{t("originalPolicy")}</summary><p>{displayed.record.policy.reason}</p></details>
            {displayed.record.failureCode && !detailError && <div className="error-banner" role="status">{approvalMessage(displayed.record.failureCode, locale)}</div>}
            <div className="approval-actions">{displayed.actions.map((action) => { const Icon = actionIcons[action]; return <button key={action} className={action === "approve" || action === "execute" ? "kb-primary" : "refresh-button"} type="button" disabled={busy || pending || executionPending} onClick={() => { setConfirmation({ id: displayed.record.id, action }); setReason(""); }}><Icon size={15} />{action === "execute" && displayed.record.status === "execution_unknown" ? t("approvalRetry") : t(`approvalAction_${action}`)}</button>; })}</div>
            {confirmedAction && <form className="approval-confirm" aria-label={t("approvalConfirm")} onSubmit={(event) => { event.preventDefault(); void applyAction(); }}><h3>{t(`approvalAction_${confirmedAction}`)}</h3><p>{t(confirmedAction === "execute" ? "approvalConfirm_execute" : confirmedAction === "approve" ? "approvalConfirm_approve" : confirmedAction === "reconcile" ? "approvalConfirm_reconcile" : "approvalConfirm_end")}</p><label>{t("approvalReason")} ({t(confirmedAction === "reject" ? "required" : "optional")})<textarea aria-label={t("approvalReason")} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} maxLength={500} minLength={confirmedAction === "reject" ? 3 : undefined} required={confirmedAction === "reject"} /></label><div><button className="kb-primary" type="submit" disabled={busy || (confirmedAction === "reject" && reason.trim().length < 3)}><Check size={15} />{t(busy ? "processing" : "confirmAction")}</button><button className="icon-button" type="button" title={t("approvalCancelOperation")} aria-label={t("approvalCancelOperation")} disabled={busy} onClick={() => setConfirmation(null)}><X size={16} /></button></div></form>}
            {displayed.record.ticket && <div className="approval-ticket"><h3><TicketCheck size={16} />{t("ticketReceipt")}</h3><code>{displayed.record.ticket.id}</code><p>{displayed.record.ticket.summary}</p><button className="refresh-button" type="button" disabled={busy || executionPending} onClick={() => onQueryTicket(displayed.record.ticket!.id, displayed.audit)}><Search size={15} />{t("queryCreatedTicket")}</button></div>}
            {displayed.record.execution && !displayed.record.ticket && <div className="approval-reserved"><span>{t("reservedUnconfirmed")}</span><code>{displayed.record.execution.ticketId}</code><span>{t("executionAttempts")} {displayed.record.execution.attempts} / 3</span></div>}
            <details className="approval-original"><summary>{t("originalRequest")}</summary><p>{displayed.record.query}</p><code>{displayed.record.id}</code></details>
            <section className="approval-history" aria-label={t("approvalEvents")}><h3><FileClock size={16} />{t("eventHistory")}</h3><ol>{displayed.record.events.map((event, index) => <li key={`${event.action}-${index}`}><div><strong>{t(`approvalEvent_${event.action}`)}</strong><time dateTime={event.at}>{new Date(event.at).toLocaleString(locale)}</time></div><code>{event.actor}</code>{event.reason && <p><small>{t("reviewOriginalReason")}: </small>{event.reason}</p>}</li>)}</ol></section>
          </> : !detailError && <div className="records-empty"><ShieldCheck size={26} /><span>{t(activeId ? "approvalDetailLoading" : "approvalDetailEmpty")}</span></div>}
        </aside>
      </div>
    </div>
  );
}