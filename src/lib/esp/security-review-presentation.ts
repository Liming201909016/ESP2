import type { Locale } from "./locale";
import { readReviewEvidence, reviewControls, type SecurityReview } from "./security-review";

export const reviewTranslationVersion = "1.0.0";
const evidenceTranslations = [
  {
    original: "【模拟材料】本次研发试用范围的商业许可核验结果：已核验。仅为功能演示，不代表真实厂商授权。",
    english: "[Synthetic material] Commercial licensing for this development trial scope is marked as verified. This is a functional demonstration only, not actual vendor authorization.",
  },
  {
    original: "【模拟材料】本次试用计划向未经批准的外部服务发送数据；数据外发控制尚未落实。",
    english: "[Synthetic material] This trial plans to send data to an unapproved external service. Outbound data controls have not yet been implemented.",
  },
  {
    original: "【模拟材料】本次试用仅处理合成数据，数据外发已限制在经核验的演示范围内。",
    english: "[Synthetic material] This trial processes synthetic data only. Outbound data is restricted to the verified demonstration scope.",
  },
  {
    original: "【模拟材料】本次安装包和镜像来源已通过演示来源核验；不会执行真实下载或安装。",
    english: "[Synthetic material] The installer and image sources have passed the demonstration source check. No real download or installation will be performed.",
  },
  {
    original: "【模拟补充材料】本次用途商业许可尚未核验，与原核验材料存在冲突；不得假定新材料自动覆盖旧材料。",
    english: "[Synthetic supplementary material] Commercial licensing for this use has not yet been verified. This conflicts with the original verification material; new material must not be assumed to supersede old material automatically.",
  },
] as const;
const controlTranslations = {
  "SIM-CTRL-LICENSE": {
    title: "Commercial license verification",
    requirement: "Synthetic control: commercial licensing for this use must explicitly be marked as verified.",
    recommendation: "Provide license verification material covering this use.",
    originalRequirement: "模拟检查要求：本次用途的商业许可核验结果必须明确为已核验。",
  },
  "SIM-CTRL-DATA": {
    title: "Data processing scope",
    requirement: "Synthetic control: data scope is limited to synthetic data; unapproved outbound transfer is prohibited.",
    recommendation: "Provide evidence of data scope and outbound controls; resolve unapproved transfer risk.",
    originalRequirement: "模拟检查要求：数据范围限定为合成数据，禁止未批准外发。",
  },
  "SIM-CTRL-SOURCE": {
    title: "Installer & image sources",
    requirement: "Synthetic control: installer and image sources must pass the source verification for this synthetic review.",
    recommendation: "Provide verified distribution and image sources.",
    originalRequirement: "模拟检查要求：安装和镜像来源必须经过本次模拟审查的来源核验。",
  },
} as const;

export function translatedReviewEvidence(evidence: SecurityReview["evidence"][number], policyVersion: string) {
  if (policyVersion !== "1.0.0" || evidence.version !== "1.0.0") return null;
  const known = ["complete", "high-risk", "conflicting"] as const;
  const matches = known.flatMap(readReviewEvidence).some((original) =>
    original.id === evidence.id && original.field === evidence.field && original.value === evidence.value &&
    original.documentNumber === evidence.documentNumber && original.version === evidence.version && original.excerpt === evidence.excerpt);
  return matches ? evidenceTranslations.find((entry) => entry.original === evidence.excerpt)?.english ?? null : null;
}

export function presentedReviewFinding(finding: SecurityReview["findings"][number], policyVersion: string, locale: Locale) {
  if (locale !== "en-US" || policyVersion !== "1.0.0") return finding;
  const control = reviewControls.find((entry) => entry.id === finding.controlId);
  if (!control) return finding;
  const translated = controlTranslations[control.id];
  if (finding.title !== control.title || finding.requirement !== translated.originalRequirement ||
    finding.recommendation !== (finding.status === "pass" ? "保留本次证据与版本，等待人工决定。" : control.recommendation)) return finding;
  return { ...finding, title: translated.title, requirement: translated.requirement, recommendation: translated.recommendation };
}