"use client";

import { BookOpenText, Boxes, LoaderCircle, Network, Plug, Search, TicketCheck } from "lucide-react";
import type { SkillUsageResponse } from "../lib/esp/contracts";
import { useLocale } from "./locale-provider";
import { presentedOperationName, presentedSkillDescription, presentedSkillName } from "../lib/esp/skill-presentation";

export function SkillUsagePanel({ report, pending, failed, responseReceived = false, awaitingSelection, onOpenSkill, onOpenPlugin }: {
  report: SkillUsageResponse | null;
  pending: boolean;
  failed: boolean;
  responseReceived?: boolean;
  awaitingSelection: boolean;
  onOpenSkill: (skillId: string) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const { locale, t } = useLocale();
  if (pending) return <div className="skill-usage-empty" role="status"><LoaderCircle size={21} className="skill-usage-spinner" /><div><strong>{t("skillPending")}</strong><span>{t("awaitingServer")}</span></div></div>;
  if (!report) return <div className="skill-usage-empty"><Network size={23} /><div><strong>{t(failed || responseReceived ? "skillNotReceived" : "skillNotSelected")}</strong><span>{t(failed || responseReceived ? "invocationUnknown" : "awaitingRequest")}</span></div></div>;
  const invoked = report.skillUsage.filter((skill) => skill.invoked).length;
  return (
    <section className={`skill-usage${report.skillUsage.length > 1 ? " multiple" : ""}`} aria-label={t("skillUsage")}>
      <div className="skill-usage-counts"><span>{t("skillsSelected")} <strong>{report.skillUsage.length}</strong></span><span>{t("skillsInvoked")} <strong>{invoked}</strong></span>
        {report.skillUsage.length > 1 && <><span>{t("status_completed")} <strong>{report.skillUsage.filter((skill) => skill.executionStatus === "completed").length}</strong></span><span>{t("status_failed")} <strong>{report.skillUsage.filter((skill) => skill.executionStatus === "failed").length}</strong></span></>}
      </div>
      {!report.skillUsage.length && <p className="skill-usage-none">{t(awaitingSelection ? "skillsAwaitingChoice" : "skillsNone")}</p>}
      {report.skillUsage.map((skill) => {
        const Icon = skill.category === "knowledge" ? BookOpenText : skill.category === "query" ? Search : TicketCheck;
        return <div className="skill-usage-entry" key={skill.skillId}>
          <div className="skill-usage-identity"><Icon size={22} /><div><h3>{presentedSkillName({ id: skill.skillId, name: skill.name, version: skill.version }, locale)}</h3><p><code>{skill.skillId}</code><span>v{skill.version}</span></p></div>
            <span className={`skill-usage-status ${skill.executionStatus}`}>{skill.receiptReused ? t("receiptReused") : t(`status_${skill.executionStatus}`)}</span>
          </div>
          <p className="skill-usage-description">{presentedSkillDescription({ id: skill.skillId, version: skill.version, description: skill.description }, locale)}</p>
          <details><summary>{t("originalMetadata")}</summary><p>{skill.name}</p><p>{skill.description}</p>{skill.plugin && <p>{skill.plugin.operationName}</p>}</details>
          <dl className="skill-usage-facts">
            <div><dt>{t("selectionMethod")}</dt><dd>{t(`intent_${skill.selectionSource}`)}</dd></div>
            <div><dt>{t("executionInvocation")}</dt><dd>{t(skill.receiptReused ? "receiptNotInvoked" : skill.invoked ? "invocationStarted" : "notInvoked")}</dd></div>
            <div><dt>{t("skillType")}</dt><dd>{t(`category_${skill.category}`)}</dd></div>
            {skill.knowledgeBase && <div><dt>{t("boundKnowledge")}</dt><dd>{skill.knowledgeBase.name}</dd></div>}
            <div><dt>{t("riskLevel")}</dt><dd>{t(`risk_${skill.riskLevel}`)}</dd></div>
            <div><dt>{t("boundPlugin")}</dt><dd>{skill.plugin ? <>{skill.plugin.name}<span className="skill-usage-version">v{skill.plugin.version}</span></> : t("notBound")}</dd></div>
            <div><dt>{t("boundOperation")}</dt><dd>{skill.plugin ? <><span>{presentedOperationName(skill.plugin, locale)} · {t(skill.plugin.effect === "read" ? "readOnly" : "writeAction")}</span><code>{skill.plugin.operationId}</code></> : t("status_unavailable")}</dd></div>
          </dl>
          {!!skill.matchedKeywords.length && <p className="skill-usage-keywords"><span>{t("matchedKeywords")}</span>{skill.matchedKeywords.join("、")}</p>}
          <div className="skill-usage-actions">
            <button type="button" onClick={() => onOpenSkill(skill.skillId)}><Boxes size={15} />{t("skillDetails")}</button>
            {skill.plugin && <button type="button" onClick={() => onOpenPlugin(skill.plugin!.id)}><Plug size={15} />{t("pluginDetails")}</button>}
          </div>
        </div>;
      })}
      <p className="skill-usage-request"><span>{t("requestId")}</span><code>{report.requestId}</code></p>
    </section>
  );
}