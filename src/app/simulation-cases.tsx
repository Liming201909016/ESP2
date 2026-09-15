"use client";

import { useState } from "react";
import { ExternalLink, FlaskConical, Play, RotateCcw, Search } from "lucide-react";
import { simulationCases, simulationCategories, type SimulationCase } from "../lib/esp/simulation-cases";
import { EnterpriseRecordLibrary, type EnterpriseRecordActions } from "./enterprise-records";
import { enterpriseAsOf } from "../lib/esp/enterprise-records";
import { DemoPanel } from "./demo-panel";
import { WorkflowPanel } from "./workflow-panel";
import { demoCategory, demoText, type DemoTextKey } from "../lib/esp/demo-locale";
import { useLocale } from "./locale-provider";

type Props = {
  selectedId: string;
  onSelect: (caseId: string) => void;
  onRun: (testCase: SimulationCase) => void;
  pending: boolean;
  onRunRequest: (query: string) => void;
  onOpenAudit: (id: string) => void;
} & EnterpriseRecordActions;

const outcomes: Record<SimulationCase["expected"], DemoTextKey> = {
  answer: "answer",
  no_evidence: "insufficient",
  correction_or_no_evidence: "correction_or_no_evidence",
};

export function SimulationCaseLibrary({ selectedId, onSelect, onRun, pending, onQuery, onPrepare, onOpenRecords, onRunRequest, onOpenAudit }: Props) {
  const { locale } = useLocale();
  const text = (key: DemoTextKey) => demoText(locale, key);
  const [view, setView] = useState<"cases" | "records" | "demo" | "workflow">("cases");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const normalized = search.trim().toLocaleLowerCase();
  const visibleCases = simulationCases.filter((testCase) =>
    (category === "all" || testCase.category === category) &&
    (outcome === "all" || testCase.expected === outcome) &&
    `${testCase.id} ${testCase.title} ${testCase.query} ${testCase.expectedAnswer}`.toLocaleLowerCase().includes(normalized),
  );
  const selected = visibleCases.find((testCase) => testCase.id === selectedId) ?? visibleCases[0];

  return (
    <div className="simulation-page">
      <section className="workspace-heading">
        <div><p className="eyebrow">SIMULATION LIBRARY</p><h1>{text("library")}</h1></div>
        <span className="sample-label"><FlaskConical size={14} /> {text("synthetic")}</span>
      </section>
      <div className="simulation-summary">
        <div><strong>澄川数科</strong><span>{text("snapshot")} {enterpriseAsOf}</span></div>
        <span>{simulationCases.length.toLocaleString(locale)} {text("caseCount")} · {Object.keys(simulationCategories).length.toLocaleString(locale)} {text("domainCount")}</span>
      </div>
      <div className="catalog-tabs enterprise-view-tabs" role="tablist" aria-label={text("views")}>{([{ id: "cases", label: "casesView" }, { id: "records", label: "recordsView" }, { id: "demo", label: "demoView" }, { id: "workflow", label: "workflowView" }] as const).map((item, index, items) => <button key={item.id} type="button" id={`simulation-view-${item.id}`} role="tab" aria-selected={view === item.id} aria-controls="simulation-view-panel" tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} onKeyDown={(event) => { const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length : event.key === "ArrowRight" ? (index + 1) % items.length : null; if (next === null) return; event.preventDefault(); setView(items[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }}>{text(item.label)}</button>)}</div>
      <div id="simulation-view-panel" role="tabpanel" aria-labelledby={`simulation-view-${view}`}>
      {view === "workflow" ? <WorkflowPanel pending={pending} onOpenAudit={onOpenAudit} /> : view === "demo" ? <DemoPanel pending={pending} onRun={onRunRequest} /> : view === "records" ? <EnterpriseRecordLibrary onQuery={onQuery} onPrepare={onPrepare} onOpenRecords={onOpenRecords} pending={pending} /> : <>
      <div className="case-toolbar">
        <label className="case-search"><Search size={16} /><input type="search" aria-label={text("searchCases")} placeholder={text("casePlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label={text("caseCategory")} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">{text("allCategories")}</option>
          {Object.keys(simulationCategories).map((value) => <option value={value} key={value}>{demoCategory(locale, value as keyof typeof simulationCategories)}</option>)}
        </select>
        <select aria-label={text("caseOutcome")} value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="all">{text("allOutcomes")}</option>
          {Object.entries(outcomes).map(([value, label]) => <option value={value} key={value}>{text(label)}</option>)}
        </select>
        <button className="icon-button" type="button" title={text("reset")} aria-label={text("reset")} onClick={() => { setSearch(""); setCategory("all"); setOutcome("all"); }}><RotateCcw size={16} /></button>
        <span className="case-count" role="status">{visibleCases.length} / {simulationCases.length}</span>
      </div>
      <div className="case-layout">
        <section aria-label={text("caseList")} className="case-table-wrap">
          <table className="case-table">
            <caption className="sr-only">{text("caseCaption")}</caption>
            <thead><tr><th scope="col">{text("case")}</th><th scope="col">{text("domain")}</th><th scope="col">{text("expectation")}</th></tr></thead>
            <tbody>
              {visibleCases.map((testCase) => (
                <tr key={testCase.id} className={testCase.id === selected?.id ? "selected" : ""}>
                  <td><button type="button" className="case-select" onClick={() => onSelect(testCase.id)} aria-pressed={testCase.id === selected?.id}><small>{testCase.id}</small><span>{testCase.title}</span></button></td>
                  <td>{demoCategory(locale, testCase.category)}</td>
                  <td><span className={`case-outcome ${testCase.expected}`}>{text(outcomes[testCase.expected])}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleCases.length && <div className="records-empty"><Search size={24} /><span>{text("noCases")}</span></div>}
        </section>
        <aside className="case-detail" aria-label={text("referencePanel")}>
          {selected ? (
            <>
              <p className="eyebrow">{selected.id}</p>
              <h2>{selected.title}</h2>
              <span className={`case-outcome ${selected.expected}`}>{text(outcomes[selected.expected])}</span>
              <h3>{text("question")}</h3>
              <p className="case-question">{selected.query}</p>
              <button className="case-run" type="button" onClick={() => onRun(selected)} disabled={pending}><Play size={16} /> {text(pending ? "pending" : "runCase")}</button>
              <h3>{text("answerReference")}</h3>
              <p className="case-reference">{selected.expectedAnswer}</p>
              {!!selected.facts.length && (
                <dl className="case-facts">
                  {selected.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.anyOf[0]}</dd></div>)}
                </dl>
              )}
              {[selected.source, ...(selected.alternateSources ?? [])].filter(Boolean).map((sourceId, index) => <a key={sourceId} className="case-source" href={`/knowledge/${sourceId}`} target="_blank" rel="noreferrer">{text(index === 0 ? "source" : "alternateSource")} <ExternalLink size={14} /></a>)}
            </>
          ) : <p className="case-reference">{text("noSelection")}</p>}
        </aside>
      </div>
      </>}
      </div>
    </div>
  );
}