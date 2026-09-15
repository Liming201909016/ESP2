import { translate, type Locale } from "./locale";
import { renderSecurityReport, reviewCapabilities, reviewPlugins, type SecurityReview } from "./security-review";
import { presentedReviewFinding, translatedReviewEvidence, reviewTranslationVersion } from "./security-review-presentation";

export const securityReportPresentationVersion = "1.0.0";
const labels = {
  "en-US": {
    title: "Software Security Review Report", scope: "Review scope", object: "Review object",
    query: "Original request", creator: "Requester", created: "Created", previous: "Prior review",
    evaluation: "Evaluation", complete: "Evidence complete", conflicts: "No conflicting evidence", passed: "All controls passed",
    human: "Human decision required", yes: "Yes", no: "No", severity: "Severity", none: "None", medium: "Medium", high: "High",
    noEvidence: "No evidence supplied for this control.", bindings: "Capability & Plugin versions", planned: "Not recorded as an executed stage",
    report: "Report rendering", policy: "Policy version", source: "Original control text", language: "Language",
    download: "Download HTML", json: "Download original JSON", translation: "Translation version", representation: "Presentation version",
    warning: "Synthetic materials only. This is not vendor certification, a license purchase, installation approval or permission to go live. Requester and reviewer share the DEV identity. Automated checks do not replace a human decision.",
    memory: "Current storage: process memory. Server restart clears review and audit records. A downloaded copy is not a durable server audit record.",
    blob: "Current storage: Blob. This report does not establish WORM retention or independent reviewer identity.",
    submission: "English representation of the original system entry: fixed synthetic material pack; no installation, authorization or outbound data transfer was performed.",
    reportNote: "Rendered on request from the stored review. Rendering is not a new persisted execution or human decision.",
  },
  "zh-CN": {
    title: "软件引入安全审查报告", scope: "审查范围", object: "审查对象", query: "原始请求", creator: "申请人", created: "创建时间", previous: "前次审查",
    evaluation: "评价", complete: "证据完整", conflicts: "无证据冲突", passed: "全部控制符合", human: "需要人工决定", yes: "是", no: "否",
    severity: "严重程度", none: "无", medium: "中", high: "高", noEvidence: "此控制项未提供证据。", bindings: "技能与插件版本", planned: "未记录为已执行阶段",
    report: "报告渲染", policy: "规则版本", source: "控制项原文", language: "语言", download: "下载 HTML", json: "下载原始 JSON", translation: "译文版本", representation: "展示版本",
    warning: "仅为模拟材料审查，不是厂商认证、许可购买、安装批准或真实上线许可。申请人与审查人使用 DEV 共享身份。自动检查不能代替人工决定。",
    memory: "当前存储：进程内存。服务重启将清空审查和审计记录。下载副本不是持久化服务端审计记录。",
    blob: "当前存储：Blob。本报告不代表 WORM 保留保证或独立审查人身份。",
    submission: "固定模拟材料包；未执行安装、授权或数据外发。", reportNote: "根据已存审查按请求渲染。报告渲染不代表新的已持久化执行或人工决定。",
  },
} as const;

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function renderSecurityReportHtml(record: SecurityReview, locale: Locale, backend: "memory" | "blob") {
  const canonical = renderSecurityReport(record);
  const review = canonical.review;
  const text = labels[locale];
  const translated = (key: Parameters<typeof translate>[1]) => escapeHtml(translate(locale, key));
  const date = (value: string) => `<time datetime="${escapeHtml(value)}">${escapeHtml(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "long", timeZone: "UTC" }).format(new Date(value)))}</time>`;
  const fact = (name: string, value: string) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const base = `/api/security-reviews?id=${encodeURIComponent(review.id)}`;
  const findings = review.findings.map((original) => {
    const finding = presentedReviewFinding(original, review.policyVersion, locale);
    return `<article><h3>${escapeHtml(finding.title)}</h3><p><strong>${translated(`reviewFinding_${finding.status}`)}</strong> · ${escapeHtml(text.severity)}: ${escapeHtml(text[finding.severity])}</p>
      <p>${escapeHtml(finding.requirement)}</p><p>${finding.status === "pass" ? translated("reviewRetain") : escapeHtml(finding.recommendation)}</p>
      <p><code>${escapeHtml(finding.controlId)}</code> · SIM-SOFTWARE-SECURITY-CONTROLS · ${escapeHtml(review.policyVersion)}</p>
      ${locale === "en-US" ? `<details><summary>${escapeHtml(text.source)}</summary><div lang="zh-CN"><p>${escapeHtml(original.title)}</p><p>${escapeHtml(original.requirement)}</p><p>${escapeHtml(original.recommendation)}</p></div></details>` : ""}
      ${finding.evidenceIds.length ? finding.evidenceIds.map((id) => {
        const evidence = review.evidence.find((entry) => entry.id === id);
        if (!evidence) throw new Error("REPORT_EVIDENCE_MISSING");
        const english = translatedReviewEvidence(evidence, review.policyVersion);
        return `<blockquote>${locale === "en-US" ? `<small>${english ? `${translated("reviewTranslation")}${reviewTranslationVersion}` : translated("reviewTranslationUnavailable")}</small>${english ? `<p lang="en-US">${escapeHtml(english)}</p>` : ""}` : ""}
          <small>${translated("reviewOriginal")}</small><p lang="zh-CN">${escapeHtml(evidence.excerpt)}</p><cite>${escapeHtml(evidence.documentNumber)} · v${escapeHtml(evidence.version)} · ${escapeHtml(evidence.id)}</cite></blockquote>`;
      }).join("") : `<p>${escapeHtml(text.noEvidence)}</p>`}</article>`;
  }).join("");
  const evaluation = [[text.complete, review.evaluation.evidenceComplete], [text.conflicts, review.evaluation.noConflicts], [text.passed, review.evaluation.controlsPassed], [text.human, review.evaluation.humanDecisionRequired]] as const;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(text.title)} | ${escapeHtml(review.id)}</title>
    <style>body{margin:0;color:#17211d;background:#f5f7f5;font:16px/1.6 "IBM Plex Sans","Segoe UI",sans-serif;letter-spacing:0}main{max-width:960px;margin:auto;padding:24px;overflow-wrap:anywhere}header,section{border-bottom:1px solid #bac9c3;padding:20px 0}h1{font-size:28px;line-height:1.2}h2{font-size:21px}h3{font-size:18px}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#154f3d;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:2px solid #267144;outline-offset:3px}dl>div{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,3fr);gap:16px;padding:6px 0}dt{font-weight:600}dd{margin:0;white-space:pre-wrap}article{padding:16px 0;border-top:1px solid #d8dfda}blockquote{margin:16px 0;padding:12px 16px;border-left:3px solid #7e9d90;background:#eaf0ed}blockquote p,.reason{white-space:pre-wrap}small,cite{font-size:13px}code{font-family:"IBM Plex Mono",monospace;font-size:13px}li{margin:12px 0}.warning{border-left:3px solid #a95816;padding-left:16px}summary{cursor:pointer}@media(max-width:480px){main{padding:16px}dl>div{grid-template-columns:minmax(0,1fr);gap:2px}h1{font-size:24px}}@media print{body{background:white}main{max-width:none;padding:0}nav{display:none}blockquote,article,li{break-inside:avoid}details>div{display:block}}</style></head><body><main>
    <header><p>ESP · Enterprise Skill Platform</p><h1>${escapeHtml(text.title)}</h1><p><code>${escapeHtml(review.id)}</code></p><nav aria-label="${escapeHtml(text.language)}"><a href="${base}&amp;format=html&amp;locale=en-US" lang="en-US">English</a><a href="${base}&amp;format=html&amp;locale=zh-CN" lang="zh-CN">中文</a><a href="${base}&amp;format=html&amp;locale=${locale}&amp;download=true">${escapeHtml(text.download)}</a><a href="${base}&amp;download=true">${escapeHtml(text.json)}</a></nav>
    <p class="warning">${escapeHtml(text.warning)}</p><p>${escapeHtml(backend === "memory" ? text.memory : text.blob)}</p></header>
    <section><h2>${escapeHtml(text.scope)}</h2><dl>${fact(text.object, "Docker Desktop · SIM-SW-202609-0031")}${fact(text.query, review.query)}${fact(text.creator, review.createdBy)}<div><dt>${escapeHtml(text.created)}</dt><dd>${date(review.createdAt)}</dd></div>${fact(translate(locale, "reviewCase"), translate(locale, `reviewCase_${review.caseId}`))}${fact(text.policy, `SIM-SOFTWARE-SECURITY-CONTROLS · ${review.policyVersion}`)}</dl>${review.previousReviewId ? `<p>${escapeHtml(text.previous)}: <a href="/api/security-reviews?id=${encodeURIComponent(review.previousReviewId)}&amp;format=html&amp;locale=${locale}">${escapeHtml(review.previousReviewId)}</a></p>` : ""}</section>
    <section><h2>${translated("reviewDecision")}: ${translated(`reviewStatus_${review.status}`)}</h2><p>${translated(review.evaluation.controlsPassed ? review.status === "awaiting_decision" ? "reviewChecksAwaiting" : "reviewChecksDecided" : "reviewChecksBlocked")}</p>${review.status !== "awaiting_decision" ? `<p>${translated("reviewDecisionRecorded")}</p>` : ""}<ol>${review.history.map((event) => `<li><strong>${translated(`reviewStatus_${event.action}`)}</strong> · ${date(event.at)} · ${escapeHtml(event.actor)}<p>${translated("reviewOriginalReason")}</p><p class="reason">${escapeHtml(event.reason)}</p>${locale === "en-US" && event.action === "submitted" && review.policyVersion === "1.0.0" && event.reason === "固定模拟材料包；未执行安装、授权或数据外发。" ? `<p>${escapeHtml(text.submission)}</p>` : ""}<code>${escapeHtml(event.requestId)}</code></li>`).join("")}</ol></section>
    <section><h2>${translated("reviewFindings")}</h2>${findings}</section>
    <section><h2>${escapeHtml(text.evaluation)}</h2><dl>${evaluation.map(([name, value]) => fact(name, value ? text.yes : text.no)).join("")}</dl></section>
    <section><h2>${escapeHtml(text.bindings)}</h2><ul>${reviewCapabilities.map((capability) => `<li>${translated(`reviewSkill_${capability.id}`)} · <code>${escapeHtml(capability.id)}</code> · v${escapeHtml(capability.version)} · <code>${escapeHtml(capability.operationId)}</code> · ${escapeHtml(review.stages.some((stage) => stage.skillId === capability.id) ? translate(locale, "reviewCompleted") : text.planned)}</li>`).join("")}</ul><ul>${reviewPlugins.map((plugin) => `<li><code>${escapeHtml(plugin.id)}</code> · v1.0.0 · ${plugin.operations.map(escapeHtml).join(" · ")}</li>`).join("")}</ul><h3>${escapeHtml(text.report)}</h3><p><code>${canonical.reportSkill.operationId}</code> · v${canonical.reportSkill.version}</p><p>${escapeHtml(text.reportNote)}</p></section>
    <footer><p>${escapeHtml(text.representation)}: ${securityReportPresentationVersion} · ${escapeHtml(text.translation)}: ${reviewTranslationVersion}</p></footer></main></body></html>`;
}