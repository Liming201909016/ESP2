"use client";

import { useEffect, useState } from "react";
import { BookOpenText, Boxes, ExternalLink, FileText, Play, RefreshCw, RotateCcw, Search, TicketCheck } from "lucide-react";
import { catalogResponseSchema, type CatalogEntry, type CatalogResponse } from "../lib/esp/catalog-contracts";
import { SkillEvaluationPanel, type EvaluationReports, type EvaluationSlot, type LoadedEvaluationReport } from "./skill-evaluation";
import { useLocale } from "./locale-provider";
import type { TranslationKey } from "../lib/esp/locale";
import { presentedInputLabel, presentedSkillDescription, presentedSkillName, skillSearchText } from "../lib/esp/skill-presentation";

const categories = ["knowledge", "query", "action"] as const;
const resultKeys: Record<string, TranslationKey> = {
  knowledge_answer: "catalogResult_knowledge_answer", knowledge_not_found: "catalogResult_knowledge_not_found",
  ticket_status: "catalogResult_ticket_status", input_required: "catalogResult_input_required",
  ticket_not_found: "catalogResult_ticket_not_found", ticket_details_required: "catalogResult_ticket_details_required",
  ticket_created: "catalogResult_ticket_created", unavailable: "catalogResult_unavailable",
};
const detailTabs = [
  { id: "overview" },
  { id: "contract" },
  { id: "references" },
  { id: "evaluation" },
] as const;

type CatalogProps = {
  selectedId: string | null;
  onSelect: (skillId: string) => void;
  onTry: (skillId: string, query: string) => void;
  onOpenCase: (caseId: string) => void;
  executionPending: boolean;
};

function CatalogDetails({ entry, busy, onTry, onOpenCase, evaluationReports, onEvaluationReport }: {
  entry: CatalogEntry;
  busy: boolean;
  onTry: CatalogProps["onTry"];
  onOpenCase: CatalogProps["onOpenCase"];
  evaluationReports: EvaluationReports;
  onEvaluationReport: (slot: EvaluationSlot, loaded: LoadedEvaluationReport | null) => void;
}) {
  const { locale, t } = useLocale();
  const [tab, setTab] = useState<(typeof detailTabs)[number]["id"]>("overview");
  const [exampleId, setExampleId] = useState(entry.examples[0]?.id ?? "");
  const example = entry.examples.find((item) => item.id === exampleId);

  return (
    <aside className="catalog-detail" aria-label={t("skillDetails")}>
      <p className="eyebrow">{entry.id}</p>
      <h2>{presentedSkillName(entry, locale)}</h2>
      <div className="catalog-detail-badges">
        <span>{t(`category_${entry.category}`)}</span><span>v{entry.version}</span>
        <span className={entry.implementation === "unavailable" ? "catalog-state unavailable" : "catalog-state"}>
          {t(entry.implementation === "unavailable" ? "catalogNotConnected" : "catalogConnected")}
        </span>
      </div>
      <div className="catalog-tabs" role="tablist" aria-label={t("catalogDetailViews")}>
        {detailTabs.map((item, index) => (
          <button key={item.id} id={`catalog-tab-${item.id}`} type="button" role="tab"
            aria-selected={tab === item.id} aria-controls="catalog-panel" tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)} onKeyDown={(event) => {
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % detailTabs.length
                : event.key === "ArrowLeft" ? (index + detailTabs.length - 1) % detailTabs.length
                  : event.key === "Home" ? 0 : event.key === "End" ? detailTabs.length - 1 : null;
              if (nextIndex === null) return;
              event.preventDefault();
              setTab(detailTabs[nextIndex].id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
            }}>{t(`catalogTab_${item.id}`)}</button>
        ))}
      </div>
      <div className="catalog-panel" id="catalog-panel" role="tabpanel" aria-labelledby={`catalog-tab-${tab}`} tabIndex={0}>
        {tab === "overview" && (
          <>
            <p className="catalog-description">{presentedSkillDescription(entry, locale)}</p>
            <details><summary>{t("originalMetadata")}</summary><p>{entry.name}</p><p>{entry.description}</p></details>
            <dl className="catalog-metadata">
              <div><dt>{t("catalogImplementation")}</dt><dd>{entry.implementation === "knowledge" ? "AI Search + Foundry" : entry.implementation === "unavailable" ? t("status_unavailable") : `${entry.storageBackend === "postgres" ? "PostgreSQL" : "Blob"} · ${t(entry.implementation === "ticket_create" ? "writeAction" : "readOnly")}`}</dd></div>
              <div><dt>{t("riskLevel")}</dt><dd>{t(`risk_${entry.riskLevel}`)}</dd></div>
              <div><dt>{t("catalogConfirmation")}</dt><dd>{t(entry.confirmationRequired ? "catalogRequiresConfirmation" : "catalogNoConfirmation")}</dd></div>
              <div><dt>{t("catalogPermissions")}</dt><dd>{entry.permissions.map((permission) => <code key={permission}>{permission}</code>)}</dd></div>
              <div><dt>{t("catalogCases")}</dt><dd>{entry.examples.length.toLocaleString(locale)}</dd></div>
              <div><dt>{t("catalogSources")}</dt><dd>{entry.sources.length.toLocaleString(locale)}</dd></div>
              {entry.knowledgeBase && <div><dt>{t("boundKnowledge")}</dt><dd>{entry.knowledgeBase.name}<br /><code>{entry.knowledgeBase.indexName}</code></dd></div>}
            </dl>
            <h3>{t("catalogKeywords")}</h3>
            <p className="catalog-keywords">{entry.keywords.join(" · ")}</p>
          </>
        )}
        {tab === "contract" && (
          <>
            <h3>{t("catalogInputs")} <code>{entry.inputLocation}</code></h3>
            <dl className="catalog-inputs">
              {entry.inputs.map((input) => (
                <div key={input.name}>
                  <dt>{presentedInputLabel(input, locale)} <span>{t(input.required ? "required" : "optional")}</span><code>{input.name}</code></dt>
                  <dd>
                    {!!input.options.length && <span>{input.options.map((option) => option === "individual" || option === "team" || option === "organization" ? t(`impact_${option}`) : option).join(" / ")}</span>}
                    {input.maxLength !== null && <span>{input.minLength !== null ? `${input.minLength}-` : `${t("catalogAtMost")} `}{input.maxLength} {t("catalogCharacters")}</span>}
                    {input.pattern && <code>{input.pattern}</code>}
                  </dd>
                </div>
              ))}
            </dl>
            <h3>{t("catalogOutputs")}</h3>
            <ul className="catalog-output-list">
              {entry.resultTypes.map((resultType) => <li key={resultType}><span>{Object.hasOwn(resultKeys, resultType) ? t(resultKeys[resultType]) : resultType}</span><code>{resultType}</code></li>)}
            </ul>
            <details className="catalog-schema"><summary>JSON Schema</summary><pre>{JSON.stringify(entry.inputSchema, null, 2)}</pre></details>
          </>
        )}
        {tab === "references" && (
          <>
            <h3>{t("catalogCases")} ({entry.examples.length})</h3><small>{t("originalMetadata")}</small>
            <ul className="catalog-reference-list">
              {entry.examples.map((item) => (
                <li key={item.id}>
                  {item.caseId ? (
                    <button className="catalog-case-link" type="button" onClick={() => onOpenCase(item.caseId!)}><FileText size={14} /><span>{item.id} · {item.title}</span></button>
                  ) : <span>{item.title}</span>}
                  <p>{item.query}</p>
                </li>
              ))}
            </ul>
            <h3>{t("catalogSources")} ({entry.sources.length})</h3>
            {!entry.sources.length && <p className="catalog-description">{t("catalogNoDocuments")}</p>}
            <ul className="catalog-reference-list">
              {entry.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noreferrer"><span>{source.title}</span><ExternalLink size={14} /></a>
                  <small>{source.documentNumber} · {source.owner}</small>
                  <small>{t(source.dataKind === "snapshot" ? "snapshotDate" : "effectiveDate")} {source.effectiveDate} · {source.version}</small>
                </li>
              ))}
            </ul>
          </>
        )}
        <div hidden={tab !== "evaluation"}>
          {entry.evaluation ? <SkillEvaluationPanel profile={entry.evaluation} reports={evaluationReports} onReport={onEvaluationReport} /> : <p className="catalog-description">{t("catalogNoEvaluation")}</p>}
        </div>
      </div>
      <div className="catalog-trial" hidden={tab === "evaluation"}>
        <label htmlFor="catalog-example">{t("catalogTrialCase")}</label>
        <select id="catalog-example" value={exampleId} disabled={busy || !entry.examples.length} onChange={(event) => setExampleId(event.target.value)}>
          {entry.examples.length ? entry.examples.map((item) => <option key={item.id} value={item.id}>{item.title}</option>) : <option value="">{t("catalogNoExamples")}</option>}
        </select>
        {example && <p><small>{t("originalRequest")}: </small>{example.query}</p>}
        <button className="catalog-try" type="button" disabled={busy || !example || entry.implementation === "unavailable"}
          onClick={() => { if (example) onTry(entry.id, example.query); }}><Play size={16} />{t("catalogTry")}</button>
      </div>
    </aside>
  );
}

export function SkillCatalogView({ selectedId, onSelect, onTry, onOpenCase, executionPending }: CatalogProps) {
  const { locale, t } = useLocale();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [confirmation, setConfirmation] = useState("all");
  const [implementation, setImplementation] = useState("all");
  const [evaluationReports, setEvaluationReports] = useState<EvaluationReports>({ baseline: null, candidate: null });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/skills", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) { if (!controller.signal.aborted) { setCatalog(null); setError(response.status === 401 || response.status === 403 ? "catalogError_access" : "catalogError_load"); } return; }
        const parsed = catalogResponseSchema.safeParse(await response.json());
        if (!parsed.success) { if (!controller.signal.aborted) { setCatalog(null); setError("catalogError_contract"); } return; }
        if (!controller.signal.aborted) setCatalog(parsed.data);
      } catch {
        if (!controller.signal.aborted) {
          setCatalog(null);
          setError("catalogError_load");
        }
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  function refresh() {
    setError(null);
    setPending(true);
    setRevision((current) => current + 1);
  }

  const skills = catalog?.skills ?? [];
  const search = query.trim().toLowerCase();
  const visible = skills.filter((skill) =>
    (category === "all" || skill.category === category) &&
    (confirmation === "all" || skill.confirmationRequired === (confirmation === "required")) &&
    (implementation === "all" || (implementation === "implemented" ? skill.implementation !== "unavailable" : skill.implementation === "unavailable")) &&
    skillSearchText(skill).includes(search),
  );
  const selected = visible.find((skill) => skill.id === selectedId) ?? visible[0];

  return (
    <div className="catalog-page">
      <section className="workspace-heading">
        <div><p className="eyebrow">SKILL REGISTRY</p><h1>{t("catalog")}</h1></div>
        <button className="refresh-button" type="button" onClick={refresh} disabled={pending}><RefreshCw size={15} />{t(pending ? "loading" : "catalogRefresh")}</button>
      </section>
      <div className="catalog-summary">
        <span><strong>{skills.length}</strong> {t("visibleSkills")}</span>
        {categories.map((value) => <span key={value}><strong>{skills.filter((skill) => skill.category === value).length}</strong> {t(`category_${value}`)}</span>)}
      </div>
      <div className="catalog-toolbar case-toolbar">
        <label className="case-search"><Search size={16} /><input type="search" aria-label={t("catalogSearch")} placeholder={t("catalogSearchHint")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label={t("catalogCategory")} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">{t("catalogAllCategories")}</option>
          {categories.map((value) => <option value={value} key={value}>{t(`category_${value}`)}</option>)}
        </select>
        <select aria-label={t("catalogConfirmation")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)}>
          <option value="all">{t("catalogAllConfirmations")}</option><option value="required">{t("catalogRequiresConfirmation")}</option><option value="not_required">{t("catalogNoConfirmation")}</option>
        </select>
        <select aria-label={t("catalogImplementation")} value={implementation} onChange={(event) => setImplementation(event.target.value)}>
          <option value="all">{t("catalogAllImplementations")}</option><option value="implemented">{t("catalogConnected")}</option><option value="unavailable">{t("catalogNotConnected")}</option>
        </select>
        <button className="icon-button" type="button" title={t("catalogReset")} aria-label={t("catalogReset")} onClick={() => { setQuery(""); setCategory("all"); setConfirmation("all"); setImplementation("all"); }}><RotateCcw size={16} /></button>
        <span className="case-count" role="status">{visible.length} / {skills.length}</span>
      </div>
      {error && <div className="error-banner" role="alert">{t(error)}</div>}
      {pending && <p className="catalog-loading" role="status">{t("catalogLoading")}</p>}
      <div className="catalog-layout" aria-busy={pending}>
        <section className="catalog-table-wrap" aria-label={t("catalogList")}>
          <table className="catalog-table">
            <caption className="sr-only">{t("catalogCaption")}</caption>
            <thead><tr><th scope="col">{t("catalogSkill")}</th><th scope="col">{t("catalogCategory")}</th><th scope="col" className="catalog-secondary">{t("catalogVersion")}</th><th scope="col" className="catalog-secondary">{t("catalogConfirmation")}</th><th scope="col">{t("catalogImplementation")}</th></tr></thead>
            <tbody>
              {visible.map((skill) => {
                const Icon = skill.category === "knowledge" ? BookOpenText : skill.category === "query" ? Search : TicketCheck;
                return (
                  <tr key={skill.id} className={skill.id === selected?.id ? "selected" : ""}>
                    <td><button type="button" className="catalog-select" onClick={() => onSelect(skill.id)} aria-pressed={skill.id === selected?.id}>
                      <Icon size={17} /><span><strong>{presentedSkillName(skill, locale)}</strong><small>{skill.id}</small></span>
                    </button></td>
                    <td>{t(`category_${skill.category}`)}</td>
                    <td className="catalog-secondary"><code>{skill.version}</code></td>
                    <td className="catalog-secondary">{t(skill.confirmationRequired ? "catalogRequiresConfirmation" : "catalogNoConfirmation")}</td>
                    <td><span className={skill.implementation === "unavailable" ? "catalog-state unavailable" : "catalog-state"}>{t(skill.implementation === "unavailable" ? "catalogNotConnected" : "catalogConnected")}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pending && !error && !visible.length && <div className="records-empty"><Boxes size={26} /><span>{t(skills.length ? "catalogNoMatches" : "catalogNoSkills")}</span></div>}
          {catalog && <p className="catalog-updated">{t("catalogUpdated")} <time dateTime={catalog.generatedAt}>{new Date(catalog.generatedAt).toLocaleString(locale)}</time></p>}
        </section>
        {selected ? <CatalogDetails key={selected.id} entry={selected} busy={executionPending || pending} onTry={onTry} onOpenCase={onOpenCase}
          evaluationReports={evaluationReports} onEvaluationReport={(slot, loaded) => setEvaluationReports((current) => ({ ...current, [slot]: loaded }))} /> : (
          <aside className="catalog-detail catalog-empty-detail"><Boxes size={28} /><p>{t(pending ? "catalogDetailLoading" : "catalogDetailEmpty")}</p></aside>
        )}
      </div>
    </div>
  );
}