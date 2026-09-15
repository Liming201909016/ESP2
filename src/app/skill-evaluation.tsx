"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileCheck2, Upload, X } from "lucide-react";
import type { EvaluationProfile, ImprovementTarget, SkillEvaluationReport } from "../lib/esp/skill-evaluation-contracts";
import {
  compareSkillEvaluations, createImprovementProposal, evaluationFileLimit, evaluationIssue,
  parseSkillEvaluationReport, SkillEvaluationError, summarizeSkillEvaluation,
} from "../lib/esp/skill-evaluation";
import { useLocale } from "./locale-provider";
import { evaluationCodeLabel, evaluationErrorKey, evaluationText, type EvaluationTextKey } from "../lib/esp/evaluation-locale";
import type { Locale } from "../lib/esp/locale";

export type EvaluationSlot = "baseline" | "candidate";
export type LoadedEvaluationReport = { filename: string; report: SkillEvaluationReport };
export type EvaluationReports = Record<EvaluationSlot, LoadedEvaluationReport | null>;

const targets = ["routing", "retrieval", "knowledge", "grounding", "plugin", "runtime", "evaluation"] as const satisfies readonly ImprovementTarget[];

function ratioLabel(value: { numerator: number; denominator: number; rate: number | null } | undefined, locale: Locale) {
  return !value || value.rate === null ? evaluationText(locale, "notEvaluated") : `${value.numerator.toLocaleString(locale)} / ${value.denominator.toLocaleString(locale)} (${new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value.rate)})`;
}

function reportVersion(loaded: LoadedEvaluationReport | null, skillId: string, locale: Locale) {
  if (!loaded) return evaluationText(locale, "notLoaded");
  const runtime = loaded.report.provenance?.runtimeBefore;
  const skill = runtime?.skills.find((item) => item.id === skillId);
  return `${skill ? `v${skill.version}` : evaluationText(locale, "unknownSkill")} · ${runtime?.release?.buildId ?? evaluationText(locale, "unknownRelease")}`;
}

export function SkillEvaluationPanel({ profile, reports, onReport }: {
  profile: EvaluationProfile;
  reports: EvaluationReports;
  onReport: (slot: EvaluationSlot, loaded: LoadedEvaluationReport | null) => void;
}) {
  const { locale } = useLocale();
  const text = (key: EvaluationTextKey) => evaluationText(locale, key);
  const label = (code: string) => evaluationCodeLabel(locale, code);
  const seconds = (value: number | null | undefined) => value == null ? text("notEvaluated") : `${(value / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
  const [pending, setPending] = useState<EvaluationSlot | null>(null);
  const [error, setError] = useState<EvaluationTextKey | null>(null);
  const [filter, setFilter] = useState("all");
  const [target, setTarget] = useState<ImprovementTarget>("grounding");
  const [hypothesis, setHypothesis] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [page, setPage] = useState(0);
  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current += 1; }, []);

  const baseline = reports.baseline?.report;
  const candidate = reports.candidate?.report;
  const before = baseline ? summarizeSkillEvaluation(profile, baseline) : null;
  const after = candidate ? summarizeSkillEvaluation(profile, candidate) : null;
  const comparison = baseline && candidate ? compareSkillEvaluations(profile, baseline, candidate) : null;
  const current = candidate ?? baseline;
  const currentSummary = after ?? before;
  const rows = (current?.results ?? []).filter((item) => item.skillId === profile.skillId && (
    filter === "all" || (filter === "failed" && !item.passed) ||
    (filter === "regression" && comparison?.regressions.includes(item.caseId)) || (filter === "improved" && comparison?.improvements.includes(item.caseId))
  ));
  const pageCount = Math.max(1, Math.ceil(rows.length / 8));
  const activePage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(activePage * 8, (activePage + 1) * 8);

  async function loadReport(slot: EvaluationSlot, file: File) {
    const version = ++requestVersion.current;
    setPending(slot); setError(null); setExported(false); onReport(slot, null);
    try {
      if (file.size > evaluationFileLimit) throw new SkillEvaluationError("REPORT_TOO_LARGE");
      if (!file.name.toLowerCase().endsWith(".json")) throw new SkillEvaluationError("INVALID_REPORT");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const report = parseSkillEvaluationReport(text);
      if (version !== requestVersion.current) return;
      onReport(slot, { filename: file.name, report }); setPage(0);
    } catch (cause) {
      if (version === requestVersion.current) setError(evaluationErrorKey(cause instanceof SkillEvaluationError ? cause.code : null, "importFailed"));
    } finally {
      if (version === requestVersion.current) setPending(null);
    }
  }

  async function exportProposal() {
    if (!baseline || !candidate) return;
    const version = ++requestVersion.current;
    setExporting(true); setError(null); setExported(false);
    try {
      const proposal = await createImprovementProposal(profile, baseline, candidate, target, hypothesis);
      if (version !== requestVersion.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(proposal, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `skill-proposal-${proposal.id}.json`; link.click(); URL.revokeObjectURL(url);
      setExported(true);
    } catch (cause) {
      if (version === requestVersion.current) setError(evaluationErrorKey(cause instanceof SkillEvaluationError ? cause.code : null, "exportFailed"));
    } finally { if (version === requestVersion.current) setExporting(false); }
  }

  const metrics = [
    { label: text("metricPass"), before: ratioLabel(before?.pass, locale), after: ratioLabel(after?.pass, locale) },
    { label: text("metricAnswer"), before: ratioLabel(before?.answer, locale), after: ratioLabel(after?.answer, locale) },
    { label: text("metricAbstention"), before: ratioLabel(before?.abstention, locale), after: ratioLabel(after?.abstention, locale) },
    { label: text("metricFalseRefusal"), before: ratioLabel(before?.falseRefusal, locale), after: ratioLabel(after?.falseRefusal, locale) },
    { label: text("metricVerification"), before: ratioLabel(before?.verificationRejected, locale), after: ratioLabel(after?.verificationRejected, locale) },
    { label: text("metricExecution"), before: ratioLabel(before?.executionError, locale), after: ratioLabel(after?.executionError, locale) },
    { label: text("metricP95"), before: seconds(before?.p95DurationMs), after: seconds(after?.p95DurationMs) },
  ];

  return (
    <div className="skill-evaluation" aria-label={text("title")}>
      <div className="evaluation-heading"><h3>{text("contract")}</h3><span>v{profile.version}</span></div>
      <dl className="catalog-metadata">
        <div><dt>{text("ownerRole")}</dt><dd>{label(profile.ownerRole)} · {text("unassigned")}</dd></div>
        <div><dt>{text("skillVersion")}</dt><dd>v{profile.skillVersion}</dd></div>
        <div><dt>{text("sampleThreshold")}</dt><dd>{profile.minimumCases.toLocaleString(locale)} {text("uniqueCases")}</dd></div>
        <div><dt>{text("autoPublish")}</dt><dd>{text("off")}</dd></div>
      </dl>
      <details className="evaluation-contract">
        <summary>{text("criteria")}</summary>
        <h4>{text("success")}</h4><ul>{profile.successCriteria.map((criterion) => <li key={criterion}>{label(criterion)}</li>)}</ul>
        <h4>{text("abstain")}</h4><ul>{profile.abstentionCriteria.map((criterion) => <li key={criterion}>{label(criterion)}</li>)}</ul>
      </details>
      <h3>{text("gates")}</h3>
      <ul className="evaluation-gates">{profile.hardGates.map((gate) => {
        const failed = currentSummary?.gates.find((item) => item.id === gate)?.status === "failed";
        return <li key={gate}><span>{label(gate)}</span><strong className={failed ? "evaluation-failed" : ""}>{text(failed ? "failed" : "notEvaluated")}</strong></li>;
      })}</ul>
      <h3>{text("records")}</h3>
      <p className="evaluation-scope">{text("localOnly")}</p>
      <div className="evaluation-imports">
        {(["baseline", "candidate"] as const).map((slot) => (
          <section key={slot} className="evaluation-import" aria-label={text(slot === "baseline" ? "baselineReport" : "candidateReport")}>
            <div className="evaluation-import-heading"><strong>{text(slot)}</strong>
              {reports[slot] && <button className="icon-button" type="button" disabled={pending !== null || exporting} title={text(slot === "baseline" ? "clearBaseline" : "clearCandidate")} aria-label={text(slot === "baseline" ? "clearBaseline" : "clearCandidate")} onClick={() => { onReport(slot, null); setExported(false); setError(null); setPage(0); }}><X size={14} /></button>}
            </div>
            <label className={`evaluation-upload${pending !== null || exporting ? " disabled" : ""}`}>
              <Upload size={14} /><span>{text(pending === slot ? "validating" : "load")}</span>
              <input type="file" accept=".json,application/json" aria-label={text(slot === "baseline" ? "loadBaseline" : "loadCandidate")} disabled={pending !== null || exporting} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void loadReport(slot, file); }} />
            </label>
            <p>{reports[slot]?.filename ?? text("noReport")}</p>
            {reports[slot] && <small><time dateTime={reports[slot]!.report.completedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "long", timeZone: "UTC" }).format(new Date(reports[slot]!.report.completedAt))}</time></small>}
            <small>{reportVersion(reports[slot], profile.skillId, locale)}</small>
          </section>
        ))}
      </div>
      {error && <p className="error-banner" role="alert">{text(error)}</p>}
      {profile.kind !== "knowledge" ? <p className="evaluation-notice">{text("ticketUnavailable")}</p> : <div className="evaluation-table-wrap">
        <table className="evaluation-metrics"><caption className="sr-only">{text("metrics")}</caption>
          <thead><tr><th scope="col">{text("metric")}</th><th scope="col">{text("baseline")}</th><th scope="col">{text("candidate")}</th></tr></thead>
          <tbody>{metrics.map((metric) => <tr key={metric.label}><th scope="row">{metric.label}</th><td>{metric.before}</td><td>{metric.after}</td></tr>)}</tbody>
        </table>
      </div>}
      <div className="evaluation-status" role="status">
        <FileCheck2 size={17} /><div><strong>{comparison ? text(comparison.status) : text(current ? "single" : "noEvidence")}</strong>
          <small>{currentSummary ? `${currentSummary.sampleSize.toLocaleString(locale)} ${text("skillCases")} · ${text(currentSummary.evidence === "insufficient_samples" ? "insufficient_samples" : "regressionOnly")}` : text("noHoldout")}</small>
          {comparison && <small>{text(comparison.status === "not_comparable" ? "observed" : "paired")}: {text("improvements")} {comparison.improvements.length} · {text("regressions")} {comparison.regressions.length}</small>}
        </div>
      </div>
      {comparison && <ul className="evaluation-blockers">{comparison.blockers.map((reason) => <li key={reason}>{label(reason)}</li>)}</ul>}
      {current && <>
        <div className="evaluation-case-toolbar"><h3>{text("cases")}</h3><select aria-label={text("filter")} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}>
          <option value="all">{text("allCases")}</option><option value="failed">{text("failedCases")}</option><option value="regression">{text("regressedCases")}</option><option value="improved">{text("improvedCases")}</option>
        </select></div>
        <ul className="evaluation-cases">{visibleRows.map((item) => {
          const issue = evaluationIssue(item);
          return <li key={item.caseId}><details>
            <summary><code>{item.caseId}</code><span className={item.passed ? "" : "evaluation-failed"}>{text(item.passed ? "assertionPassed" : "failed")}</span></summary>
            {issue && <p>{label(issue.target)} · {label(issue.reason)} · {text("provisional")}</p>}
            <dl><div><dt>{text("outcome")}</dt><dd>{item.executionStatus ?? text("unknown")}</dd></div><div><dt>{text("failureCode")}</dt><dd>{item.failureCode ?? text("none")}</dd></div><div><dt>{text("requestId")}</dt><dd>{item.requestId ?? text("notRecorded")}</dd></div><div><dt>{text("duration")}</dt><dd>{item.durationMs.toLocaleString(locale)} ms</dd></div></dl>
          </details></li>;
        })}</ul>
        {!rows.length && <p className="evaluation-notice">{text("noCases")}</p>}
        <div className="evaluation-pagination"><button className="icon-button" type="button" disabled={activePage === 0} onClick={() => setPage(activePage - 1)} aria-label={text("previous")} title={text("previous")}><ChevronLeft size={16} /></button><span>{activePage + 1} / {pageCount}</span><button className="icon-button" type="button" disabled={activePage + 1 >= pageCount} onClick={() => setPage(activePage + 1)} aria-label={text("next")} title={text("next")}><ChevronRight size={16} /></button></div>
      </>}
      <h3>{text("proposal")}</h3>
      <form className="evaluation-proposal" onSubmit={(event) => { event.preventDefault(); void exportProposal(); }}>
        <label htmlFor="evaluation-target">{text("target")}</label><select id="evaluation-target" value={target} disabled={exporting} onChange={(event) => { setTarget(event.target.value as ImprovementTarget); setExported(false); }}>
          {targets.map((value) => <option key={value} value={value}>{text(value)}</option>)}
        </select>
        <label htmlFor="evaluation-hypothesis">{text("hypothesis")}</label><textarea id="evaluation-hypothesis" value={hypothesis} minLength={10} maxLength={2_000} rows={4} disabled={exporting} onChange={(event) => { setHypothesis(event.target.value); setExported(false); }} />
        <div className="evaluation-proposal-meta"><span>{hypothesis.length} / 2000</span><span>{text("draft")}</span></div>
        <button className="catalog-try" type="submit" disabled={exporting || pending !== null || !before?.sampleSize || !after?.sampleSize || hypothesis.trim().length < 10}><Download size={15} />{text(exporting ? "generating" : "export")}</button>
        {exported && <p className="evaluation-notice" role="status">{text("exported")}</p>}
      </form>
    </div>
  );
}