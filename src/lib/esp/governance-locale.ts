import type { Locale } from "./locale";

const messages = {
  businessSkills: ["Business Skills", "业务 Skill"],
  catalogGroups: ["Skill catalog groups", "Skill 目录分组"],
  businessRefresh: ["Refresh business Skills", "刷新业务 Skill"],
  title: ["Repository governance", "仓库治理"],
  inspect: ["Inspect repository governance", "检查仓库治理"],
  plan: ["Get repository validation plan", "获取仓库验证计划"],
  refresh: ["Refresh governance catalog", "刷新治理目录"],
  run: ["Run Skill", "运行技能"],
  loading: ["Loading governance catalog", "正在加载治理目录"],
  running: ["Reading governance snapshot", "正在读取治理快照"],
  denied: ["Repository governance requires governance.read permission.", "仓库治理需要 governance.read 权限。"],
  unavailable: ["Governance data is unavailable. No automatic retry was made.", "治理数据不可用，未自动重试。"],
  auditFailed: ["Audit start failed. The governance tool was not invoked.", "审计起始记录失败，治理工具未调用。"],
  uncertain: [
    "No verified response received. The read may have run; no automatic retry was made.",
    "未收到有效响应，读取可能已执行，未自动重试。",
  ],
  not_configured: ["Trusted runtime package not configured", "未配置可信运行包"],
  manifest_verified: ["Package manifest verified · Tool not probed", "运行包清单已验证 · 工具未探测"],
  packageUnavailable: ["Trusted runtime package unavailable", "可信运行包不可用"],
  skill: ["Skill", "技能"],
  permission: ["Required permission", "所需权限"],
  actions: ["Run", "操作"],
  snapshot: ["Packaged snapshot · Not a live repository scan", "打包时快照 · 非实时仓库扫描"],
  commit: ["Source commit", "来源提交"],
  collected: ["Collected at", "采集时间"],
  digest: ["Input digest", "输入摘要"],
  dirty: ["Included uncommitted changes", "包含未提交改动"],
  clean: ["Clean worktree at collection", "采集时工作区干净"],
  commands: ["Validation plan · Commands not executed", "验证计划 · 未执行命令"],
  json: ["Original response JSON", "原始响应 JSON"],
  recovery: ["Recovery mode", "恢复模式"],
  review: ["Code review mode", "代码审查模式"],
  contracts: ["Documentation contracts checked at collection", "采集时检查的文档契约数"],
  result: ["Governance result", "治理结果"],
} as const;
export type GovernanceTextKey = keyof typeof messages;
export function governanceText(locale: Locale, key: GovernanceTextKey) {
  return messages[key][locale === "en-US" ? 0 : 1];
}
