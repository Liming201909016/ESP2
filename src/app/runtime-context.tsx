"use client";

import { ChevronRight, Clock3, FileClock } from "lucide-react";
import type { Locale } from "../lib/esp/locale";
import { useLocale } from "./locale-provider";

const traceLabels: Record<string, readonly [string, string]> = {
  "request.validated": ["Request validated", "请求已验证"],
  "intent.keyword": ["Keyword intent selected", "已采用关键词意图"],
  "intent.model": ["Model intent selected", "已采用模型意图"],
  "intent.selection": ["Explicit Skill selection", "已明确选择技能"],
  "intent.rate_limited": ["Intent recognition rate limited", "意图识别被限流"],
  "intent.failed": ["Intent recognition failed", "意图识别失败"],
  "intent.awaiting_selection": ["Awaiting intent selection", "等待选择意图"],
  "skill.matched": ["Skill matched", "已匹配技能"],
  "skill.not_matched": ["No Skill matched", "未匹配技能"],
  "parameters.awaiting_input": ["Awaiting required input", "等待必填信息"],
  "policy.approval_required": ["Policy requires approval", "策略要求审批"],
  "execution.awaiting_confirmation": ["Awaiting confirmation", "等待确认"],
  "execution.started": ["Execution started", "执行已开始"],
  "execution.completed": ["Execution completed", "执行已完成"],
  "execution.not_found": ["No accessible record found", "未找到可访问记录"],
  "execution.no_evidence": ["Insufficient evidence", "资料不足"],
  "execution.unavailable": ["Execution unavailable", "执行不可用"],
  "execution.rate_limited": ["Execution rate limited", "执行被限流"],
  "execution.failed": ["Execution failed", "执行失败"],
  "approval.pending": ["Approval pending", "等待审批"],
  "approval.approved": ["Approval granted", "审批已通过"],
  "approval.rejected": ["Approval rejected", "审批已拒绝"],
  "approval.executed": ["Approved action executed", "已执行获批操作"],
  "approval.submission_failed": ["Approval submission failed", "审批提交失败"],
  "parallel.planned": ["Parallel reads planned", "已规划并行读取"],
  "parallel.completed": ["Parallel reads completed", "并行读取已完成"],
  "parallel.partial": ["Parallel reads partially completed", "并行读取部分完成"],
  "parallel.rejected": ["Parallel request rejected", "并行请求被拒绝"],
  "parallel.failed": ["Parallel reads failed", "并行读取失败"],
  "workflow.selected": ["Workflow selected", "已选择流程"],
  "workflow.rejected": ["Workflow request rejected", "流程请求被拒绝"],
  "workflow.failed": ["Workflow failed", "流程失败"],
};

export function runtimeTraceLabel(locale: Locale, step: string) {
  return Object.hasOwn(traceLabels, step) ? traceLabels[step][locale === "en-US" ? 0 : 1] : step;
}

export function runtimeIdentityLabel(locale: Locale, source: "development" | "entra" | "none") {
  const labels = {
    development: ["Shared DEV identity", "DEV 共享身份"],
    entra: ["Microsoft Entra ID", "Microsoft Entra ID"],
    none: ["No authenticated identity", "无已认证身份"],
  } as const;
  return labels[source][locale === "en-US" ? 0 : 1];
}

export function RuntimeTrace({ trace }: { trace?: readonly { step: string; at: string }[] }) {
  const { locale, t } = useLocale();
  return <div className="trace-list">
    {trace?.length ? trace.map((item, index) => {
      const label = runtimeTraceLabel(locale, item.step);
      return <div className="trace-item" key={`${item.step}-${index}`}>
        <div className="trace-index">{String(index + 1).padStart(2, "0")}</div>
        <div><strong>{label}</strong>{label !== item.step && <code>{item.step}</code>}<span><Clock3 size={12} /><time dateTime={item.at}>{new Date(item.at).toLocaleTimeString(locale)}</time></span></div>
        <ChevronRight size={15} />
      </div>;
    }) : <div className="trace-placeholder"><FileClock size={22} /><span>{t("noExecutions")}</span></div>}
  </div>;
}