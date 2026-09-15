"use client";

import { useEffect, useState } from "react";
import { BookOpenText, Plug, RefreshCw, RotateCcw, Search, TicketCheck } from "lucide-react";
import { pluginCatalogResponseSchema, type PluginCatalogEntry, type PluginCatalogResponse } from "../lib/esp/plugin-contracts";
import { PluginTrialPanel, type PluginWritePreview } from "./plugin-trial";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";
import { pluginText, type PluginTextKey } from "../lib/esp/plugin-locale";
import { presentedOperationName, presentedSkillName } from "../lib/esp/skill-presentation";

const tabs = [{ id: "trial", label: "trial" }, { id: "contract", label: "contractTab" }, { id: "dependencies", label: "dependencies" }] as const;

function PluginDetails({ entry, disabled, onReview, executionPending, onOpenAudit }: {
  entry: PluginCatalogEntry; disabled: boolean; onReview: (preview: PluginWritePreview, audit?: AuditReceipt) => void; executionPending: boolean; onOpenAudit?: (id: string) => void;
}) {
  const { locale } = useLocale();
  const text = (key: PluginTextKey) => pluginText(locale, key);
  const [operationId, setOperationId] = useState(entry.operations[0].id);
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("trial");
  const operation = entry.operations.find((item) => item.id === operationId) ?? entry.operations[0];
  return (
    <section className="plugin-detail" aria-label={text("details")}>
      <header className="plugin-detail-heading"><div><p className="eyebrow">{entry.id}</p><h2>{entry.name}</h2></div><div className="plugin-badges"><span>{text("registered")}</span><code>v{entry.version}</code><span>{text("contract")} {entry.contractVersion}</span></div></header>
      <div className="plugin-operation-heading"><label>{text("operation")}<select aria-label={text("operationSelect")} value={operation.id} onChange={(event) => setOperationId(event.target.value as typeof operationId)}>{entry.operations.map((item) => <option key={item.id} value={item.id}>{presentedOperationName({ operationId: item.id, operationName: item.name, version: entry.version }, locale)}</option>)}</select></label><div><code>{operation.id}</code><span>{text(operation.effect === "write" ? "writeConfirmation" : "readOnly")}</span></div></div>
      <div className="catalog-tabs plugin-tabs" role="tablist" aria-label={text("detailViews")}>{tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`plugin-tab-${item.id}`} aria-controls={`plugin-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); setTab(tabs[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{text(item.label)}</button>)}</div>
      <div className="plugin-panel" hidden={tab !== "trial"} id="plugin-panel-trial" role="tabpanel" aria-labelledby="plugin-tab-trial"><PluginTrialPanel key={operation.id} plugin={entry} operation={operation} disabled={disabled} onReview={onReview} executionPending={executionPending} onOpenAudit={onOpenAudit} /></div>
      <div className="plugin-panel" hidden={tab !== "contract"} id="plugin-panel-contract" role="tabpanel" aria-labelledby="plugin-tab-contract" tabIndex={0}>
        <dl className="plugin-metadata"><div><dt>{text("permissions")}</dt><dd>{operation.permissions.map((permission) => <code key={permission}>{permission}</code>)}</dd></div><div><dt>{text("location")}</dt><dd>{text("inProcess")}</dd></div><div><dt>{text("skills")}</dt><dd>{operation.skills.map((skill) => <span key={skill.id}>{presentedSkillName(skill, locale)}<code>{skill.id}</code></span>)}</dd></div><div><dt>{text("resultTypes")}</dt><dd>{operation.resultTypes.map((type) => <code key={type}>{type}</code>)}</dd></div></dl>
        <details className="plugin-json" open><summary>{text("inputSchema")}</summary><pre>{JSON.stringify(operation.inputSchema, null, 2)}</pre></details>
        <details className="plugin-json"><summary>{text("outputSchema")}</summary><pre>{JSON.stringify(operation.outputSchema, null, 2)}</pre></details>
      </div>
      <div className="plugin-panel" hidden={tab !== "dependencies"} id="plugin-panel-dependencies" role="tabpanel" aria-labelledby="plugin-tab-dependencies" tabIndex={0}>
        <table className="plugin-dependencies"><caption className="sr-only">{text("dependencyStatus")}</caption><thead><tr><th scope="col">{text("dependency")}</th><th scope="col">{text("configuration")}</th><th scope="col">{text("connectivity")}</th></tr></thead><tbody>{entry.dependencies.map((dependency) => <tr key={dependency.id}><td><strong>{dependency.name}</strong>{dependency.requiredSettings.map((setting) => <span key={setting.name}><code>{setting.name}</code><small>{text(setting.present ? "present" : "absent")}</small></span>)}</td><td className={dependency.configured ? "plugin-configured" : "plugin-missing"}>{text(dependency.configured ? "configured" : "missing")}</td><td>{text("notProbed")}</td></tr>)}</tbody></table>
      </div>
    </section>
  );
}

export function PluginCatalogView({ selectedId, onSelect, onReview, executionPending, onOpenAudit }: {
  selectedId: string | null; onSelect: (id: string) => void; onReview: (preview: PluginWritePreview, audit?: AuditReceipt) => void; executionPending: boolean; onOpenAudit?: (id: string) => void;
}) {
  const { locale } = useLocale();
  const text = (key: PluginTextKey) => pluginText(locale, key);
  const [catalog, setCatalog] = useState<PluginCatalogResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<PluginTextKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [effect, setEffect] = useState("all");
  const [configuration, setConfiguration] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/plugins", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) { if (!controller.signal.aborted) { setCatalog(null); setError(response.status === 401 || response.status === 403 ? "catalogAccess" : "catalogFailure"); } return; }
        const parsed = pluginCatalogResponseSchema.safeParse(await response.json());
        if (!parsed.success) { if (!controller.signal.aborted) { setCatalog(null); setError("catalogInvalid"); } return; }
        if (!controller.signal.aborted) setCatalog(parsed.data);
      } catch {
        if (!controller.signal.aborted) { setCatalog(null); setError("catalogFailure"); }
      } finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load(); return () => controller.abort();
  }, [revision]);

  const plugins = catalog?.plugins ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visible = plugins.flatMap((plugin) => {
    const configured = plugin.dependencies.every((dependency) => dependency.configured);
    if (configuration !== "all" && configured !== (configuration === "configured")) return [];
    const operations = plugin.operations.filter((operation) => (effect === "all" || operation.effect === effect) &&
      `${plugin.id} ${plugin.name} ${plugin.description} ${operation.name} ${presentedOperationName({ operationId: operation.id, operationName: operation.name, version: plugin.version }, "en-US")} ${operation.id} ${operation.permissions.join(" ")} ${operation.skills.map((skill) => `${skill.name} ${presentedSkillName(skill, "en-US")}`).join(" ")}`.toLocaleLowerCase().includes(search));
    return operations.length ? [{ ...plugin, operations }] : [];
  });
  const selected = visible.find((plugin) => plugin.id === selectedId) ?? visible[0];

  return (
    <div className="plugin-page">
      <section className="workspace-heading"><div><p className="eyebrow">PLUGIN RUNTIME</p><h1>{text("title")}</h1></div><button className="refresh-button" type="button" disabled={pending} onClick={() => { setPending(true); setError(null); setRevision((current) => current + 1); }}><RefreshCw size={15} />{text(pending ? "loading" : "refresh")}</button></section>
      <div className="catalog-summary"><span><strong>{plugins.length}</strong> {text("builtin")}</span><span><strong>{plugins.flatMap((plugin) => plugin.operations).length}</strong> {text("operations")}</span><span><strong>{plugins.flatMap((plugin) => plugin.operations.flatMap((operation) => operation.skills)).length}</strong> {text("skills")}</span><span>{text("simulation")}</span></div>
      <div className="case-toolbar plugin-toolbar"><label className="case-search"><Search size={16} /><input aria-label={text("search")} type="search" placeholder={text("searchHint")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label={text("effectFilter")} value={effect} onChange={(event) => setEffect(event.target.value)}><option value="all">{text("allOperations")}</option><option value="read">{text("read")}</option><option value="write">{text("write")}</option></select><select aria-label={text("configFilter")} value={configuration} onChange={(event) => setConfiguration(event.target.value)}><option value="all">{text("allConfigs")}</option><option value="configured">{text("configured")}</option><option value="missing">{text("missing")}</option></select><button className="icon-button" type="button" title={text("reset")} aria-label={text("reset")} onClick={() => { setQuery(""); setEffect("all"); setConfiguration("all"); }}><RotateCcw size={16} /></button></div>
      {error && <div className="error-banner" role="alert">{text(error)}</div>}
      {pending && <p className="catalog-loading" role="status">{text("catalogLoading")}</p>}
      <div className="plugin-layout" aria-busy={pending}>
        <section className="plugin-list" aria-label={text("list")}><h2>{text("plugins")} <span>{visible.length} / {plugins.length}</span></h2>{visible.map((plugin) => {
          const Icon = plugin.id === "knowledge" ? BookOpenText : TicketCheck;
          return <button className={`plugin-select${plugin.id === selected?.id ? " selected" : ""}`} key={plugin.id} type="button" aria-label={`${plugin.name} · ${text("plugins")}`} aria-pressed={plugin.id === selected?.id} onClick={() => onSelect(plugin.id)}><Icon size={19} /><span><strong>{plugin.name}</strong><small>{plugin.id} · v{plugin.version}</small><span>{plugin.operations.length} {text("operations")} · {text(plugin.dependencies.every((dependency) => dependency.configured) ? "configured" : "missing")}</span></span></button>;
        })}{!pending && !error && !visible.length && <div className="plugin-empty"><Plug size={24} /><p>{text(plugins.length ? "noMatches" : "noPlugins")}</p></div>}{catalog && <p className="catalog-updated">{text("updated")} <time dateTime={catalog.generatedAt}>{new Date(catalog.generatedAt).toLocaleTimeString(locale)}</time></p>}</section>
        {selected ? <PluginDetails key={selected.id} entry={selected} disabled={pending || executionPending} onReview={onReview} executionPending={executionPending} onOpenAudit={onOpenAudit} /> : <section className="plugin-detail plugin-empty"><Plug size={28} /><p>{text(pending ? "detailLoading" : "noDetails")}</p></section>}
      </div>
    </div>
  );
}