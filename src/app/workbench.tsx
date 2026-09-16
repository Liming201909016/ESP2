"use client";

import { FormEvent, startTransition, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  BookOpenText,
  Boxes,
  Check,
  CircleDot,
  Clock3,
  Database,
  FileClock,
  FlaskConical,
  Gauge,
  GitBranch,
  KeyRound,
  Network,
  Pencil,
  Plug,
  RefreshCw,
  Search,
  UserRound,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { skillUsageResponseSchema, type ExecutionResult, type ExecutionStatus, type IntentContext, type RouteResult, type SkillParameters, type SkillUsageResponse, type TicketExecutionResult } from "../lib/esp/contracts";
import { simulationCases, type SimulationCase } from "../lib/esp/simulation-cases";
import { SimulationCaseLibrary } from "./simulation-cases";
import { IntentChoiceForm, TicketDetailsForm } from "./request-input";
import { SkillCatalogView } from "./skill-catalog";
import { KnowledgeLibraryView } from "./knowledge-library";
import { PluginCatalogView } from "./plugin-catalog";
import type { PluginWritePreview } from "./plugin-trial";
import { approvalDisplayId, approvalPolicyReason, PolicyApprovalsView } from "./policy-approvals";
import type { ApprovalDetail } from "../lib/esp/approval-contracts";
import type { TicketPolicyDecision } from "../lib/esp/approval-policy";
import { AuditLedgerView } from "./audit-ledger";
import { AuditFeedback, auditParentHeaders, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt, AuditReference } from "../lib/esp/audit-contracts";
import { BlobConnectorView } from "./blob-connector";
import { SkillUsagePanel } from "./skill-usage";
import { knowledgeMissingMessage, knowledgeVerificationMessage } from "./knowledge-feedback";
import { parallelReadResultSchema, type ParallelReadResult } from "../lib/esp/parallel-read-contracts";
import { KnowledgeAnswerView, ParallelReadResults } from "./parallel-results";
import { catalogResponseSchema, type CatalogResponse } from "../lib/esp/catalog-contracts";
import { routedWorkflowResponseSchema, ticketGuidanceWorkflow, type WorkflowResult } from "../lib/esp/workflow-contracts";
import { WorkflowResults } from "./workflow-panel";
import { SecurityReviewPanel } from "./security-review-panel";
import { discoverSecurityReview } from "../lib/esp/security-review";
import { LanguageSelector, useLocale } from "./locale-provider";
import type { TranslationKey } from "../lib/esp/locale";
import { governanceText } from "../lib/esp/governance-locale";
import { RuntimeTrace, runtimeIdentityLabel } from "./runtime-context";

class RequestFailure extends Error {
  constructor(public key: TranslationKey, public verificationReason?: unknown, public retryAfterSeconds?: number, public requestId?: string) { super(key); }
}

type RouteResponse = {
  requestId: string;
  executionStatus: ExecutionStatus;
  identity: {
    displayName: string | null;
    source: "entra" | "development" | "none";
  };
  execution: ExecutionResult | null;
  parallel?: ParallelReadResult;
  workflow?: WorkflowResult;
  policy?: TicketPolicyDecision | null;
  approval?: ApprovalDetail | null;
  confirmation?: { id: string; expiresAt: string; ticketId: string } | null;
  route: RouteResult;
  intent: IntentContext;
  trace: { step: string; at: string }[];
};

type TicketRecord = TicketExecutionResult["ticket"];

type View = "workbench" | "records" | "cases" | "catalog" | "knowledge" | "plugins" | "approvals" | "audit" | "connectors" | "security";

const examples = [
  "reviewDefaultQuery", "exampleLeave", "exampleExpense", "exampleProcurement", "examplePhishing",
  "exampleSoftware", "exampleTicketStatus", "exampleTicketCreate", "exampleBeijing", "exampleIT", "exampleParallel", "exampleWorkflow",
] as const;

const navigation = [
  { label: "工作台", icon: Gauge, view: "workbench" as const },
  { label: "安全审查", icon: ShieldCheck, view: "security" as const },
  { label: "模拟案例", icon: FlaskConical, view: "cases" as const },
  { label: "技能目录", icon: Boxes, view: "catalog" as const },
  { label: "知识库", icon: BookOpenText, view: "knowledge" as const },
  { label: "插件目录", icon: Plug, view: "plugins" as const },
  { label: "连接器", icon: Database, view: "connectors" as const },
  { label: "执行记录", icon: FileClock, view: "records" as const },
  { label: "策略与审批", icon: ShieldCheck, view: "approvals" as const },
  { label: "审计记录", icon: GitBranch, view: "audit" as const },
];

const workspaceGroups = [
  { id: "employee", labels: ["Employee Workspace", "员工工作区"], views: ["workbench", "security", "records", "approvals"] },
  { id: "operations", labels: ["Capability Operations", "能力运营"], views: ["catalog", "knowledge", "plugins", "connectors", "audit"] },
  { id: "demo", labels: ["Demo Center", "演示中心"], views: ["cases"] },
] as const;

export function WorkspaceNavigation({ activeView, onSelect }: { activeView: View; onSelect: (view: View) => void }) {
  const { locale, t } = useLocale();
  return <details className="workspace-menu" open>
    <summary>{t("mainNavigation")} · {t(activeView)}</summary>
    <nav aria-label={t("mainNavigation")}>
      {workspaceGroups.map((group) => <section className="workspace-nav-group" key={group.id} aria-labelledby={`workspace-nav-${group.id}`}>
        <h2 id={`workspace-nav-${group.id}`}>{group.labels[locale === "en-US" ? 0 : 1]}</h2>
        {group.views.map((view) => {
          const Icon = navigation.find((entry) => entry.view === view)!.icon;
          return <button className={view === activeView ? "nav-item active" : "nav-item"} type="button" key={view} aria-label={t(view)} title={t(view)} aria-current={view === activeView ? "page" : undefined} onClick={() => onSelect(view)}><Icon size={18} /><span>{t(view)}</span></button>;
        })}
      </section>)}
    </nav>
  </details>;
}

export function Workbench() {
  const { locale, t } = useLocale();
  const [catalogRuntime, setCatalogRuntime] = useState<CatalogResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/skills", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
        const catalog = catalogResponseSchema.parse(await response.json());
        if (!controller.signal.aborted) { setCatalogRuntime(catalog); setRuntimeError(false); }
      } catch { if (!controller.signal.aborted) { setCatalogRuntime(null); setRuntimeError(true); } }
    }
    void load(); return () => controller.abort();
  }, [runtimeRevision]);
  const [query, setQuery] = useState(() => t(examples[0]));
  const [result, setResult] = useState<RouteResponse | null>(null);
  const [skillUsage, setSkillUsage] = useState<SkillUsageResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RequestFailure | null>(null);
  const [activeView, setActiveView] = useState<View>("workbench");
  const [securityReviewId, setSecurityReviewId] = useState<string | null>(null);
  const [securityReviewQuery, setSecurityReviewQuery] = useState<string | undefined>();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [recordsPending, setRecordsPending] = useState(false);
  const [recordsError, setRecordsError] = useState<TranslationKey | null>(null);
  const [recordState, setRecordState] = useState<{ backend: "blob" | "postgres"; writesPaused: boolean } | null>(null);
  const [ticketIdDraft, setTicketIdDraft] = useState("");
  const [simulationCaseId, setSimulationCaseId] = useState(simulationCases[0].id);
  const [editingTicket, setEditingTicket] = useState(false);
  const [catalogSkillId, setCatalogSkillId] = useState<string | null>(null);
  const [knowledgeDocumentId, setKnowledgeDocumentId] = useState<string | null>(null);
  const [knowledgeParent, setKnowledgeParent] = useState<AuditReceipt | null>(null);
  const [connectorSourceId, setConnectorSourceId] = useState<string | null>(null);
  const [pluginId, setPluginId] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const approvalSubmissionId = useRef<string | null>(null);
  const ticketConfirmation = useRef<{ id: string; expiresAt: string; ticketId: string; query: string; parameters: SkillParameters } | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [approvalParent, setApprovalParent] = useState<AuditReceipt | null>(null);
  const [requestAudit, setRequestAudit] = useState<AuditReceipt | null>(null);
  const [recordsAudit, setRecordsAudit] = useState<AuditReceipt | null>(null);
  const requestParentAudit = useRef<AuditReceipt | null>(null);

  function updateQuery(value: string) {
    approvalSubmissionId.current = null;
    ticketConfirmation.current = null;
    requestParentAudit.current = null; setRequestAudit(null);
    setQuery(value);
    setResult(null);
    setSkillUsage(null);
    setError(null);
    setTicketIdDraft("");
    setEditingTicket(false);
  }

  async function loadTickets() {
    setRecordsPending(true);
    setRecordsError(null);
    try {
      const response = await fetch("/api/tickets", { cache: "no-store" });
      const payload = (await response.json()) as { tickets?: TicketRecord[]; state?: { backend: "blob" | "postgres"; writesPaused: boolean } };
      setRecordState(payload.state ?? null);
      setRecordsAudit(readAuditReceipt(payload));
      if (!response.ok || !payload.tickets) throw new Error("执行记录加载失败");
      startTransition(() => {
        setTickets(payload.tickets ?? []);
        setSelectedTicketId((current) =>
          payload.tickets?.some((ticket) => ticket.id === current)
            ? current
            : payload.tickets?.[0]?.id ?? null,
        );
      });
    } catch {
      setRecordsError("recordsUnavailable");
    } finally {
      setRecordsPending(false);
    }
  }

  function selectView(view: View) {
    setActiveView(view);
    if (view === "records") void loadTickets();
  }

  function queryTicket(ticketId: string, audit?: AuditReceipt) {
    const lookupQuery = `查询工单 ${ticketId} 的状态`;
    updateQuery(lookupQuery);
    requestParentAudit.current = audit ?? null;
    setActiveView("workbench");
    void routeRequest(false, lookupQuery);
  }

  function runSimulation(testCase: SimulationCase) {
    if (pending) return;
    setSimulationCaseId(testCase.id);
    updateQuery(testCase.query);
    setActiveView("workbench");
    void routeRequest(false, testCase.query);
  }

  function tryCatalogSkill(skillId: string, requestQuery: string, audit?: AuditReceipt) {
    if (pending) return;
    setCatalogSkillId(skillId);
    updateQuery(requestQuery);
    requestParentAudit.current = audit ?? null;
    setActiveView("workbench");
    void routeRequest(false, requestQuery, { selectedSkillId: skillId });
  }

  function openCatalogCase(caseId: string) {
    setSimulationCaseId(caseId);
    setActiveView("cases");
  }

  function reviewPluginPreview(preview: PluginWritePreview, audit?: AuditReceipt) {
    if (pending) return;
    updateQuery(preview.query);
    requestParentAudit.current = audit ?? null;
    setActiveView("workbench");
    void routeRequest(false, preview.query, { selectedSkillId: preview.selectedSkillId, parameters: preview.parameters });
  }

  function openApproval(id: string, audit?: AuditReceipt | null) {
    setApprovalParent(audit ?? null); setApprovalId(id); setActiveView("approvals");
  }

  function openAudit(id: string) { setAuditId(id); setActiveView("audit"); }

  function openKnowledgeDocument(id: string, audit?: AuditReceipt) {
    setKnowledgeDocumentId(id); setKnowledgeParent(audit ?? null); setActiveView("knowledge");
  }

  function openConnectorSource(id: string | null) { setConnectorSourceId(id); setActiveView("connectors"); }

  function openAuditReference(reference: AuditReference) {
    if (reference.type === "security_review" && /^sr-[a-f0-9]{32}$/.test(reference.id)) { setSecurityReviewId(reference.id); setActiveView("security"); }
    else if (reference.type === "approval" && /^apr-[a-f0-9]{32}$/.test(reference.id)) openApproval(reference.id);
    else if (reference.type === "ticket" && /^ESP-\d{8}-[A-F0-9]{8}$/.test(reference.id)) queryTicket(reference.id);
    else if (reference.type === "document" && /^kb-[a-f0-9]{32}$/.test(reference.id)) openKnowledgeDocument(reference.id);
    else if (reference.type === "source" && /^(?:dev-[a-z0-9-]+|kb-[a-f0-9]{32}-c\d{3})$/.test(reference.id)) window.open(`/knowledge/${reference.id}`, "_blank", "noopener,noreferrer");
    else if (reference.type === "skill") { setCatalogSkillId(reference.id); setActiveView("catalog"); }
    else if (reference.type === "plugin") { setPluginId(reference.id); setActiveView("plugins"); }
    else if (reference.type === "policy") setActiveView("approvals");
    else if (reference.type === "connector_source" && /^[a-z0-9][a-z0-9-]{2,63}$/.test(reference.id)) openConnectorSource(reference.id);
    else if (reference.type === "connector" && reference.id === "blob-knowledge") openConnectorSource(null);
  }

  async function routeRequest(confirmed = false, requestQuery = query, options: { selectedSkillId?: string; parameters?: SkillParameters } = {}, preserveConfirmation = false) {
    if (pending) return;
    if (!confirmed && !preserveConfirmation) ticketConfirmation.current = null;
    if (!confirmed || !approvalSubmissionId.current) approvalSubmissionId.current = crypto.randomUUID();
    setPending(true);
    setError(null);
    setResult(null);
    setSkillUsage(null);

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auditParentHeaders(requestParentAudit.current) },
        body: JSON.stringify({ query: requestQuery, confirmed, ...options, submissionId: approvalSubmissionId.current, ...(confirmed && ticketConfirmation.current ? { confirmationId: ticketConfirmation.current.id } : {}) }),
      });
      const payload = await response.json().catch(() => null);
      const usage = skillUsageResponseSchema.safeParse(payload);
      const audit = readAuditReceipt(payload); setRequestAudit(audit);
      if (audit?.status === "recorded" || audit?.status === "incomplete") requestParentAudit.current = audit;
      const parallel = payload?.route?.status === "parallel" ? parallelReadResultSchema.safeParse(payload.parallel) : null;
      const workflow = payload?.route?.status === "workflow" ? routedWorkflowResponseSchema.safeParse(payload) : null;
      if (workflow && !workflow.success || payload?.workflow && !workflow || parallel && payload?.workflow) throw new RequestFailure("routeError_workflow");
      if (parallel && (!parallel.success || payload.executionStatus !== parallel.data.executionStatus || !usage.success ||
        JSON.stringify(usage.data.skillUsage) !== JSON.stringify(parallel.data.tasks.map((task) => task.usage)))) {
        throw new RequestFailure("routeError_parallel");
      }
      if (usage.success) setSkillUsage(usage.data);
      if (!response.ok && !(parallel?.success && response.status === 502 && parallel.data.executionStatus === "failed") && !(workflow?.success && response.status === 502 && workflow.data.executionStatus === "failed")) {
        const key: TranslationKey = payload?.error === "AUDIT_START_FAILED" ? "routeError_audit"
          : payload?.error === "KNOWLEDGE_VERIFICATION_FAILED"
          ? "knowledgeVerification_default"
          : payload?.error === "MODEL_RATE_LIMITED"
          ? "rateLimited"
          : payload?.error === "DEV_REVIEW_REQUIRED" ? "routeError_dev"
          : payload?.error === "SUBMISSION_CONFLICT" ? "routeError_submission"
          : payload?.error === "APPROVAL_SERVICE_FAILED" ? "routeError_approval"
          : payload?.error === "STATE_WRITES_PAUSED" ? "routeError_maintenance"
          : payload?.error === "INTENT_UNAVAILABLE"
          ? "routeError_intent"
          : ["CONFIRMATION_REQUIRED", "CONFIRMATION_EXPIRED", "CONFIRMATION_CONFLICT", "CONFIRMATION_NOT_FOUND"].includes(payload?.error)
          ? "routeError_confirmation"
          : payload?.error === "CONFIRMATION_UNAVAILABLE"
          ? "routeError_confirmationUnavailable"
          : payload?.error === "PARALLEL_READ_PLAN_INVALID"
          ? "routeError_parallelPlan"
          : payload?.error === "WORKFLOW_BINDING_INVALID"
          ? "routeError_workflowBinding"
          : response.status === 502
          ? "routeError_service"
          : response.status === 401 || response.status === 403
            ? "routeError_access"
            : "routeError_invalid";
          const retryAfterSeconds = key === "rateLimited" ? Number.isInteger(payload.retryAfterSeconds) && payload.retryAfterSeconds >= 1 && payload.retryAfterSeconds <= 86_400 ? payload.retryAfterSeconds : 60 : undefined;
          const requestId = typeof payload?.requestId === "string" && /^[a-f0-9-]{36}$/i.test(payload.requestId) ? payload.requestId : undefined;
          throw new RequestFailure(key, payload?.verificationReason, retryAfterSeconds, requestId);
      }
      if (!payload?.route) throw new RequestFailure("routeError_response");
      if (payload.confirmation) {
        const entry = payload.confirmation;
        if (typeof entry.id !== "string" || !/^[a-f0-9-]{36}$/i.test(entry.id) || typeof entry.ticketId !== "string" || !/^ESP-\d{8}-[A-F0-9]{8}$/.test(entry.ticketId) || !Number.isFinite(Date.parse(entry.expiresAt))) throw new RequestFailure("routeError_confirmationContract");
        ticketConfirmation.current = { ...entry, query: requestQuery, parameters: payload.intent.parameters };
      }
      if (payload.execution?.type === "ticket_created") ticketConfirmation.current = null;

      startTransition(() => {
        setResult({ ...payload, ...(parallel?.success ? { parallel: parallel.data } : {}), ...(workflow?.success ? { workflow: workflow.data.workflow } : {}) } as RouteResponse);
        setEditingTicket(false);
      });
    } catch (requestError) {
      setError(requestError instanceof RequestFailure ? requestError : new RequestFailure("routeError_uncertain"));
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (discoverSecurityReview(query)) { setSecurityReviewId(null); setSecurityReviewQuery(query); setActiveView("security"); return; }
    void routeRequest();
  }

  const matched = result?.route.status === "matched" ? result.route : null;
  const receiptTicket =
    result?.execution?.type === "ticket_created" || result?.execution?.type === "ticket_status"
      ? result.execution.ticket
      : null;
  const knowledgeAnswer = result?.execution?.type === "knowledge_answer" ? result.execution : null;
  const clarification = result?.execution?.type === "intent_clarification" ? result.execution : null;
  const draftParameters = result?.intent.parameters ?? {};
  const currentTrace = skillUsage?.trace ?? result?.trace;
  const selectionSource = result?.intent.source ?? skillUsage?.skillUsage[0]?.selectionSource;
  const selectedTicket =
    tickets.find((ticket) => ticket.id === selectedTicketId) ?? null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Network size={18} /></div>
          <div><strong>ESP</strong><span>Enterprise Skill Platform</span></div>
        </div>
        <div className="topbar-actions">
          <span className="simulation-banner">{t("simulation")}</span>
          <LanguageSelector />
          <div className="environment"><CircleDot size={13} /> {catalogRuntime?.runtime?.environment === "unknown" || !catalogRuntime?.runtime ? t("unknown") : catalogRuntime.runtime.environment.toUpperCase()}</div>
          <button className="icon-button" type="button" aria-label={t("searchCases")} title={t("searchCases")} onClick={() => selectView("cases")}><Search size={18} /></button>
          <button className="icon-button" type="button" aria-label={t("refreshRuntime")} title={t("refreshRuntime")} onClick={() => { setCatalogRuntime(null); setRuntimeError(false); setRuntimeRevision((value) => value + 1); }}><RefreshCw size={18} /></button>
          <div className="avatar" aria-label={catalogRuntime?.runtime?.identity.source === "development" ? t("sharedIdentity") : `${t("currentIdentity")} ${catalogRuntime?.runtime?.identity.displayName ?? t("unknown")}`} title={catalogRuntime?.runtime?.identity.source === "development" ? t("sharedIdentity") : catalogRuntime?.runtime?.identity.displayName ?? t("unknown")}><UserRound size={18} /></div>
        </div>
      </header>

      <aside className="sidebar">
        <WorkspaceNavigation activeView={activeView} onSelect={selectView} />
        <div className="sidebar-status">
          <span className="status-line">{catalogRuntime ? t("catalogLoaded") : runtimeError ? t("runtimeUnavailable") : t("runtimeLoading")}</span>
          <span title={catalogRuntime?.evaluationRuntime?.release?.releaseId}>{catalogRuntime?.evaluationRuntime?.release ? `${t("release")} ${catalogRuntime.evaluationRuntime.release.releaseId.slice(0, 8)}` : t("releaseUnknown")}</span>
        </div>
      </aside>

      <main className="workspace">
        {activeView === "connectors" ? (
          <BlobConnectorView selectedId={connectorSourceId} onSelect={setConnectorSourceId} onOpenDocument={openKnowledgeDocument} onOpenAudit={openAudit} />
        ) : activeView === "audit" ? (
          <AuditLedgerView selectedId={auditId} onSelect={setAuditId} onReference={openAuditReference} />
        ) : activeView === "security" ? (
          <SecurityReviewPanel onOpenAudit={openAudit} initialId={securityReviewId} initialQuery={securityReviewQuery} />
        ) : activeView === "approvals" ? (
          <PolicyApprovalsView selectedId={approvalId} onSelect={setApprovalId} onQueryTicket={queryTicket} executionPending={pending} initialAudit={approvalParent} onOpenAudit={openAudit} onPrepare={(requestQuery, parameters) => {
            updateQuery(requestQuery); setActiveView("workbench"); void routeRequest(false, requestQuery, { selectedSkillId: "create-it-ticket", parameters });
          }} />
        ) : activeView === "plugins" ? (
          <PluginCatalogView selectedId={pluginId} onSelect={setPluginId} onReview={reviewPluginPreview} executionPending={pending} onOpenAudit={openAudit} />
        ) : activeView === "knowledge" ? (
          <KnowledgeLibraryView selectedId={knowledgeDocumentId} onSelect={setKnowledgeDocumentId} onTest={tryCatalogSkill} onOpenAudit={openAudit} initialAudit={knowledgeParent} onOpenConnector={openConnectorSource} />
        ) : activeView === "catalog" ? (
          <SkillCatalogView selectedId={catalogSkillId} onSelect={setCatalogSkillId} onTry={tryCatalogSkill} onOpenCase={openCatalogCase} executionPending={pending} onOpenAudit={openAudit} />
        ) : activeView === "cases" ? (
          <SimulationCaseLibrary selectedId={simulationCaseId} onSelect={setSimulationCaseId} onRun={runSimulation} pending={pending} onOpenAudit={openAudit} onRunRequest={(requestQuery) => { if (pending) return; updateQuery(requestQuery); setActiveView("workbench"); void routeRequest(false, requestQuery); }} onQuery={tryCatalogSkill} onOpenRecords={() => selectView("records")} onPrepare={(requestQuery, parameters) => { updateQuery(requestQuery); setActiveView("workbench"); void routeRequest(false, requestQuery, { selectedSkillId: "create-it-ticket", parameters }); }} />
        ) : activeView === "records" ? (
          <>
            <section className="workspace-heading">
              <div><p className="eyebrow">EXECUTION LEDGER</p><h1>{t("records")}</h1></div>
              <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={recordsPending}>
                <RefreshCw size={15} />{t(recordsPending ? "loading" : "refresh")}
              </button>
            </section>
            {recordsError && <div className="error-banner records-error" role="alert">{t(recordsError)}</div>}
            {recordsPending && <p role="status">{t("recordsLoading")}</p>}
            {recordState && <p className="catalog-updated">{recordState.backend === "postgres" ? "PostgreSQL" : "Blob"} · {t(recordState.writesPaused ? "stateWritesPaused" : "stateWritesEnabled")}</p>}
            <AuditFeedback receipt={recordsAudit} onOpen={openAudit} />
            <section className="records-layout" aria-label={t("recordsLabel")}>
              <div className="records-table-wrap">
                <table className="records-table">
                  <thead><tr><th>{t("ticketId")}</th><th>{t("ticketSummary")}</th><th>{t("ticketStatus")}</th><th>{t("createdAt")}</th></tr></thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr
                        className={ticket.id === selectedTicketId ? "selected" : ""}
                        key={ticket.id}
                        onClick={() => setSelectedTicketId(ticket.id)}
                      >
                        <td><button className="refresh-button" type="button" aria-pressed={ticket.id === selectedTicketId} onClick={() => setSelectedTicketId(ticket.id)}>{ticket.id}</button></td>
                        <td>{ticket.summary}</td>
                        <td><span className="ticket-status">{t("ticketOpen")}</span></td>
                        <td>{new Date(ticket.createdAt).toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!recordsPending && !recordsError && tickets.length === 0 && (
                  <div className="records-empty"><FileClock size={24} /><span>{t("recordsEmpty")}</span></div>
                )}
              </div>
              <aside className="record-detail">
                <div className="section-title compact"><div><p className="eyebrow">RECEIPT</p><h2>{t("ticketDetails")}</h2></div></div>
                {selectedTicket ? (
                  <div className="record-detail-body">
                    <span className="ticket-status">{t("ticketOpen")}</span>
                    <strong>{selectedTicket.id}</strong>
                    <p>{selectedTicket.summary}</p>
                    <dl>
                      <div><dt>{t("createdAt")}</dt><dd>{new Date(selectedTicket.createdAt).toLocaleString(locale)}</dd></div>
                      <div><dt>{t("recordsOwner")}</dt><dd>{selectedTicket.createdBy}</dd></div>
                      {selectedTicket.details?.device && <div><dt>{t("ticketDevice")}</dt><dd>{selectedTicket.details.device}</dd></div>}
                      {selectedTicket.details && <div><dt>{t("ticketImpact")}</dt><dd>{t(`impact_${selectedTicket.details.impact}`)}</dd></div>}
                    </dl>
                    <button type="button" onClick={() => queryTicket(selectedTicket.id)} disabled={pending}><Search size={15} />{t("recordsQuery")}</button>
                  </div>
                ) : <div className="records-empty"><span>{t("recordsSelect")}</span></div>}
              </aside>
            </section>
          </>
        ) : (
          <>
        <section className="workspace-heading">
          <div><p className="eyebrow">ESP WORKSPACE</p><h1>{t("workbenchTitle")}</h1></div>
          <div className="workspace-tools">
            <button className="icon-button" type="button" title={t("knowledge")} aria-label={t("knowledge")} onClick={() => selectView("knowledge")}><BookOpenText size={18} /></button>
            <button className="icon-button" type="button" title={t("catalog")} aria-label={t("catalog")} onClick={() => selectView("catalog")}><Boxes size={18} /></button>
            <button className="refresh-button" type="button" onClick={() => selectView("cases")}><FlaskConical size={15} />{t("cases")}</button>
            <div className="runtime-chip"><Activity size={15} /> {catalogRuntime ? `${catalogRuntime.skills.length} ${governanceText(locale, "businessSkills")}` : t("skillsUnknown")}</div>
          </div>
        </section>

        <div className="workspace-grid">
          <section className="command-column" aria-label={t("businessRequest")}>
            <form className="composer" onSubmit={submit}>
              <div className="composer-label"><span>{t("businessRequest")}</span><span>{query.length} / 2000</span></div>
              <textarea value={query} onChange={(event) => updateQuery(event.target.value)} maxLength={2000} rows={4} aria-label={t("businessRequest")} disabled={pending} />
              <div className="composer-footer">
                <div className="example-list">
                  {examples.map((example) => (
                    <button type="button" key={example} onClick={() => updateQuery(t(example))} disabled={pending}>{t(example)}</button>
                  ))}
                </div>
                <button className="route-button" type="submit" disabled={pending || !query.trim()}>
                  {t(pending ? "processing" : "discoverSkills")}<ArrowUp size={17} />
                </button>
              </div>
            </form>

            {error && <div className="error-banner" role="alert">{error.key === "knowledgeVerification_default" ? knowledgeVerificationMessage(error.verificationReason, locale) : t(error.key)}{error.retryAfterSeconds !== undefined ? ` ${error.retryAfterSeconds.toLocaleString(locale)}` : ""}{error.requestId ? ` (${error.requestId})` : ""}</div>}
            {(error || result?.execution?.type === "ticket_not_found" || result?.execution?.type === "ticket_status") && ticketConfirmation.current && <div className="confirmation-actions">
              <button type="button" disabled={pending} onClick={() => { const saved = ticketConfirmation.current!; void routeRequest(false, `查询工单 ${saved.ticketId} 的状态`, { selectedSkillId: "get-ticket-status", parameters: { ticketId: saved.ticketId } }, true); }}><Search size={16} />{t("checkReservedReceipt")}</button>
              <button type="button" disabled={pending} onClick={() => { const saved = ticketConfirmation.current!; void routeRequest(true, saved.query, { selectedSkillId: "create-it-ticket", parameters: saved.parameters }); }}><RefreshCw size={16} />{t("retrySubmission")}</button>
            </div>}
            <AuditFeedback receipt={requestAudit} onOpen={openAudit} />

            <section className="decision-panel" aria-live="polite">
              <div className="section-title">
                <div><p className="eyebrow">SKILL SELECTION & EXECUTION</p><h2>{t("selectedSkills")}</h2></div>
                {result && <span className={`decision-state ${result.executionStatus}`}>{t(`status_${result.executionStatus}`)}</span>}
              </div>

              <SkillUsagePanel report={skillUsage} pending={pending} failed={Boolean(error)} responseReceived={Boolean(result)} awaitingSelection={Boolean(clarification)}
                onOpenSkill={(skillId) => { setCatalogSkillId(skillId); setActiveView("catalog"); }}
                onOpenPlugin={(id) => { setPluginId(id); setActiveView("plugins"); }} />

              {result && result.route.status === "no_match" && !clarification && (
                <div className="no-match"><ShieldCheck size={20} /><div><strong>{t("status_not_routed")}</strong><p>{t("noMatchPrompt")}</p><details><summary>{t("originalRoutingReason")}</summary><p>{result.route.reason}</p></details></div></div>
              )}

              {clarification && (
                <IntentChoiceForm key={result?.requestId} question={clarification.question} choices={clarification.choices} pending={pending}
                  onSelect={(selectedSkillId) => void routeRequest(false, query, { selectedSkillId })} />
              )}

              {result?.parallel && <ParallelReadResults result={result.parallel} busy={pending} onOpenAudit={openAudit} onContinue={tryCatalogSkill} />}
              {result?.workflow && requestAudit && <>
                <p className="workflow-input-origin">{t("intent_model")} · {ticketGuidanceWorkflow.id} · {t("workflowReadOnly")}</p>
                <WorkflowResults result={result.workflow} audit={requestAudit} onOpenAudit={openAudit} />
              </>}

              {matched && (
                <div className="matched-skill">
                  {knowledgeAnswer && <KnowledgeAnswerView result={knowledgeAnswer} />}
                  {result?.intent.notice === "manual_input" && <p className="input-notice" role="status">{t("parameterUnavailable")}</p>}
                  {(result?.execution?.type === "ticket_details_required" || editingTicket) && (
                    <TicketDetailsForm key={result?.requestId} parameters={draftParameters} pending={pending}
                      onContinue={(parameters) => void routeRequest(false, query, { selectedSkillId: matched.skill.id, parameters })} />
                  )}
                  {result?.executionStatus === "waiting_confirmation" && !editingTicket && (
                    <>
                      <dl className="ticket-preview" aria-label={t("ticketPreview")}>
                        <div><dt>{t("ticketDescription")}</dt><dd>{draftParameters.description}</dd></div>
                        <div><dt>{t("ticketDevice")}</dt><dd>{draftParameters.device || t("unspecified")}</dd></div>
                        <div><dt>{t("ticketImpact")}</dt><dd>{draftParameters.impact ? t(`impact_${draftParameters.impact}`) : t("unspecified")}</dd></div>
                      </dl>
                      <div className="confirmation-bar">
                        <div><KeyRound size={18} /><span>{result.policy?.effect === "approval" ? approvalPolicyReason(result.policy, locale) : t("ticketWillCreate")}</span></div>
                        <div className="confirmation-actions">
                          <button type="button" onClick={() => setEditingTicket(true)} disabled={pending}><Pencil size={15} />{t("editAction")}</button>
                          <button type="button" onClick={() => void routeRequest(true, query, { selectedSkillId: matched.skill.id, parameters: draftParameters })} disabled={pending || result.policy?.effect !== "approval" && !result.confirmation}><Check size={16} />{t(result.policy?.effect === "approval" ? "submitApproval" : "confirmExecution")}</button>
                        </div>
                      </div>
                    </>
                  )}
                  {result?.approval && !receiptTicket && <div className="approval-route-result" role="status"><ShieldCheck size={20} /><div><strong>{approvalDisplayId(result.approval.record.id)} · {t(`approvalStatus_${result.approval.record.status}`)}</strong><p>{approvalPolicyReason(result.approval.record.policy, locale)}</p><details><summary>{t("originalPolicy")}</summary><p>{result.approval.record.policy.reason}</p></details><span>{t("ticketNotCreated")}</span><button className="refresh-button" type="button" onClick={() => openApproval(result.approval!.record.id, requestAudit)}><FileClock size={15} />{t("viewApproval")}</button></div></div>}
                  {result?.execution?.type === "input_required" && (
                    <form className="ticket-lookup" onSubmit={(event) => {
                      event.preventDefault();
                      queryTicket(ticketIdDraft.trim().toUpperCase());
                    }}>
                      <label htmlFor="ticket-id">{t("ticketId")}</label>
                      <div>
                        <input id="ticket-id" value={ticketIdDraft}
                          onChange={(event) => setTicketIdDraft(event.target.value.toUpperCase())}
                          placeholder="ESP-YYYYMMDD-XXXXXXXX" autoComplete="off"
                          maxLength={21} pattern="ESP-[0-9]{8}-[A-F0-9]{8}" required disabled={pending} />
                        <button type="submit" disabled={pending || !/^ESP-\d{8}-[A-F0-9]{8}$/.test(ticketIdDraft)}><Search size={16} />{t("lookup")}</button>
                      </div>
                    </form>
                  )}
                  {result?.execution?.type === "ticket_not_found" && (
                    <div className="execution-notice" role="status">
                      <Search size={19} /><p>{t("ticketNotFound")} <strong>{result.execution.ticketId}</strong></p>
                    </div>
                  )}
                  {result?.execution?.type === "unavailable" && (
                    <div className="execution-notice" role="status">
                      <Clock3 size={19} /><p>{t("skillUnavailable")}</p>
                    </div>
                  )}
                  {result?.execution?.type === "knowledge_not_found" && (
                    <div className="execution-notice" role="status">
                      <BookOpenText size={19} /><p>{knowledgeMissingMessage(result.execution.reason, locale)}</p>
                    </div>
                  )}
                  {receiptTicket && (
                    <>
                      <div className="execution-result">
                        <TicketCheck size={19} />
                        <div>
                          <span>{t(skillUsage?.skillUsage.some((skill) => skill.receiptReused) ? "existingReceipt" : result?.execution?.type === "ticket_created" ? "ticketCreated" : "ticketCurrent")}</span>
                          <strong>{receiptTicket.id}</strong>
                          <p>{receiptTicket.summary}</p>
                          {receiptTicket.details && <small>{t(`impact_${receiptTicket.details.impact}`)}{receiptTicket.details.device ? ` · ${receiptTicket.details.device}` : ""}</small>}
                          <small>{t("ticketOpen")} · {new Date(receiptTicket.createdAt).toLocaleString(locale)}</small>
                        </div>
                      </div>
                      <div className="receipt-actions">
                        <button type="button" onClick={() => queryTicket(receiptTicket.id)} disabled={pending}><RefreshCw size={15} />{t("updateStatus")}</button>
                        <button type="button" onClick={() => selectView("records")}><FileClock size={15} />{t("records")}</button>
                        {receiptTicket.approvalId && <button type="button" onClick={() => openApproval(receiptTicket.approvalId!, requestAudit)}><ShieldCheck size={15} />{t("approvalRecords")}</button>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </section>

          <aside className="context-rail" aria-label={t("runtimeContext")}>
            <section>
              <div className="section-title compact"><div><p className="eyebrow">RUNTIME</p><h2>{t("runtimeContext")}</h2></div></div>
              <dl className="context-list">
                <div><dt>{t("environment")}</dt><dd>{!catalogRuntime?.runtime || catalogRuntime.runtime.environment === "unknown" ? t("unknown") : catalogRuntime.runtime.environment.toUpperCase()}</dd></div>
                <div><dt>{t("currentIdentity")}</dt><dd>{catalogRuntime?.runtime?.identity.source === "development" ? t("sharedIdentity") : catalogRuntime?.runtime?.identity.displayName ?? t("unknown")}</dd></div>
                <div><dt>{t("identitySource")}</dt><dd>{result?.identity.source ? runtimeIdentityLabel(locale, result.identity.source) : t(skillUsage ? "notReturned" : "awaitingRequest")}</dd></div>
                <div><dt>{t("intentSource")}</dt><dd>{selectionSource ? t(`intent_${selectionSource}`) : t("awaitingRequest")}</dd></div>
                <div><dt>{t("release")}</dt><dd>{catalogRuntime?.evaluationRuntime?.release?.releaseId.slice(0, 8) ?? t("releaseUnknown")}</dd></div>
              </dl>
            </section>

            <section className="trace-section">
              <div className="section-title compact">
                <div><p className="eyebrow">EVIDENCE</p><h2>{t("trace")}</h2></div>
                {!!currentTrace?.length && <span className="trace-count">{currentTrace.length}</span>}
              </div>
              <RuntimeTrace trace={currentTrace} />
            </section>

            <section className="registry-section">
              <div className="registry-heading"><BookOpenText size={17} /><span>{t("registry")}</span></div>
              <div className="registry-value"><strong>{catalogRuntime?.skills.length ?? "--"}</strong><span>{governanceText(locale, "businessSkills")}</span></div>
            </section>
          </aside>
        </div>
          </>
        )}
      </main>
    </div>
  );
}