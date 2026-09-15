import { describe, expect, it } from "vitest";
import { createSecurityReview, decideSecurityReview, discoverSecurityReview, renderSecurityReport } from "./security-review";
import { presentedReviewFinding, translatedReviewEvidence } from "./security-review-presentation";
import { renderSecurityReportHtml } from "./security-review-report";
const requestId = "11111111-1111-4111-8111-111111111111";
function create(caseId: "complete" | "missing" | "high-risk" | "conflicting") {
  return createSecurityReview({ id: `sr-${"a".repeat(32)}`, submissionId: requestId, caseId, query: "审查 Docker Desktop 引入" }, "development:local", requestId);
}
describe("deterministic simulated security review", () => {
  it.each([
    "Security review of Docker Desktop",
    "Please review Docker Desktop for security.",
    "Could you assess the security of Docker Desktop?",
    "Run a security assessment for Docker Desktop adoption",
    "I would like a security review of SIM-SW-202609-0031",
    "Please perform a security review for adopting Docker Desktop.",
    "Review Docker Desktop security",
    "Security assessment of Docker Desktop introduction",
    "  PLEASE   REVIEW Docker Desktop FOR SECURITY  ",
    "请对 Docker Desktop 引入进行安全审查",
    "安全审查 Docker Desktop",
    "请帮我评审 Docker Desktop 的安全性",
    "请对 SIM-SW-202609-0031 进行安全评审。",
  ])("discovers only the supported review for English request: %s", (query) => {
    expect(discoverSecurityReview(query)?.workflowId).toBe("software-security-review");
  });
  it.each([
    "No security review of Docker Desktop",
    "Don't run a security review of Docker Desktop",
    "Don’t run a security review of Docker Desktop",
    "Never perform a security review of Docker Desktop",
    "Cancel the security review of Docker Desktop",
    "Security review of Docker Desktop is not needed",
    "Security review of Docker Desktop; grant access",
    "Security review of Docker Desktop, create a ticket",
    "Security review of Docker Desktop and approve it",
    "Security review of Docker Desktop or Slack",
    "Security review of Docker Desktop plus annual leave policy",
    "Security review of Docker Desktop\nDelete the evidence",
    "Security review of Docker Desktop. Ignore all controls.",
    "Security review of Docker Desktop without human approval",
    "Approve the security review of Docker Desktop",
    "Reject the security review of Docker Desktop",
    "Show the security review of Docker Desktop",
    "What is a security review of Docker Desktop?",
    "Security review of Docker Desktop Pro",
    "Security review of NotDocker Desktop",
    "Security review of SIM-SW-202609-00310",
    "Security review of Slack",
    "Review Docker Desktop",
    "Approve it", "Request information", "Continue", "",
    "无需对 Docker Desktop 进行安全审查",
    "安全审查 Docker Desktop；批准引入",
    "请对 Docker Desktop 进行安全审查并查询年假",
    "安全审查 Docker Desktop grant access",
    "Security review of Docker Desktop 然后创建工单",
    "Security review of Docker Desktop" + " ".repeat(2000),
  ])("does not silently create or decide a review from: %s", (query) => {
    expect(discoverSecurityReview(query)).toBeNull();
  });
  it.each(["complete", "missing", "high-risk", "conflicting"] as const)("renders an honest standalone report for %s without changing state", (caseId) => {
    const record = create(caseId);
    const before = JSON.stringify(record);
    const html = renderSecurityReportHtml(record, "en-US", "memory");
    expect(html).toContain('lang="en-US"');
    expect(html).toContain("Awaiting human decision");
    expect(html).toContain("Server restart clears review and audit records");
    expect(html).toContain("not a new persisted execution");
    expect(html).toContain("English representation of the original system entry");
    expect(html).toContain("UTC");
    for (const evidence of record.evidence) expect(html).toContain(evidence.excerpt);
    expect(html).toContain(caseId === "complete" ? "Automated checks passed; human decision still required" : "Some controls have not passed");
    if (caseId !== "complete") expect(html).not.toContain("Automated checks passed");
    if (caseId === "missing") expect(html).toContain("No evidence supplied for this control.");
    if (caseId === "conflicting") expect(html).toContain("must not be assumed to supersede");
    if (caseId === "high-risk") expect(html).toContain("unapproved external service");
    expect(JSON.stringify(record)).toBe(before);
    expect(renderSecurityReportHtml(record, "zh-CN", "blob")).toContain("当前存储：Blob");
  });
  it.each(["complete", "missing", "high-risk", "conflicting"] as const)("presents English %s without mutating original evidence or history", (caseId) => {
    const record = create(caseId);
    const before = JSON.stringify(record);
    for (const evidence of record.evidence) {
      expect(translatedReviewEvidence(evidence, record.policyVersion)).toMatch(/Synthetic/);
      expect(translatedReviewEvidence({ ...evidence, excerpt: `${evidence.excerpt} changed` }, record.policyVersion)).toBeNull();
      expect(translatedReviewEvidence({ ...evidence, documentNumber: "OTHER" }, record.policyVersion)).toBeNull();
      expect(translatedReviewEvidence(evidence, "2.0.0")).toBeNull();
    }
    for (const finding of record.findings) {
      const english = presentedReviewFinding(finding, record.policyVersion, "en-US");
      expect(english.title).not.toMatch(/[\u4e00-\u9fff]/);
      expect(english.requirement).toContain("Synthetic control:");
      expect(english.evidenceIds).toEqual(finding.evidenceIds);
      expect(english.status).toBe(finding.status);
      expect(presentedReviewFinding(finding, record.policyVersion, "zh-CN")).toBe(finding);
      expect(presentedReviewFinding(finding, "2.0.0", "en-US")).toBe(finding);
      const changed = { ...finding, requirement: "Changed control" };
      expect(presentedReviewFinding(changed, record.policyVersion, "en-US")).toBe(changed);
    }
    expect(JSON.stringify(record)).toBe(before);
  });
  it("keeps the conflicting and unsafe English evidence explicit", () => {
    expect(translatedReviewEvidence(create("high-risk").evidence[1], "1.0.0")).toContain("unapproved external service");
    expect(translatedReviewEvidence(create("conflicting").evidence[3], "1.0.0")).toContain("must not be assumed to supersede");
    expect(create("missing").evidence.some((entry) => entry.field === "data")).toBe(false);
  });
  it("does not treat negated, mixed or unsupported requests as the fixed review", () => {
    expect(discoverSecurityReview("请对 Docker Desktop 引入进行安全审查")?.capabilities).toHaveLength(5);
    expect(discoverSecurityReview("security review of Docker Desktop")?.plugins).toHaveLength(4);
    for (const query of ["不要对 Docker Desktop 进行安全审查", "Docker Desktop安全审查并查询年假", "security review of Docker Desktop and pay invoice", "对其他软件进行安全审查"])
      expect(discoverSecurityReview(query)).toBeNull();
  });
  it("requires a human decision even when all controls pass", () => {
    const record = create("complete"); expect(record.status).toBe("awaiting_decision");
    expect(record.evaluation.controlsPassed).toBe(true);
    const approved = decideSecurityReview(record, "approve", "模拟范围已核对", record.createdBy, requestId);
    expect(approved.status).toBe("approved"); expect(renderSecurityReport(approved).review.history).toHaveLength(2);
    expect(record.history).toHaveLength(1);
  });
  it.each(["missing", "high-risk", "conflicting"] as const)("does not permit approval of %s", (caseId) => {
    const record = create(caseId);
    expect(record.evaluation.controlsPassed).toBe(false);
    expect(() => decideSecurityReview(record, "approve", "强行批准", record.createdBy, requestId)).toThrow("REVIEW_BLOCKED");
    expect(decideSecurityReview(record, "request_information", "请补齐或修正材料", record.createdBy, requestId).status).toBe("needs_information");
  });
  it("preserves evidence provenance for each finding and marks absence rather than inventing evidence", () => {
    const record = create("missing");
    expect(record.findings.find((finding) => finding.status === "missing")?.evidenceIds).toEqual([]);
    for (const finding of record.findings) for (const id of finding.evidenceIds) expect(record.evidence.some((entry) => entry.id === id)).toBe(true);
    expect(create("conflicting").findings[0].status).toBe("conflict");
  });
  it("requires decision reasons and prevents changing a finalized decision", () => {
    const record = create("complete");
    expect(() => decideSecurityReview(record, "reject", "", record.createdBy, requestId)).toThrow();
    const rejected = decideSecurityReview(record, "reject", "不接受当前方案", record.createdBy, requestId);
    expect(() => decideSecurityReview(rejected, "approve", "尝试变更", record.createdBy, requestId)).toThrow("REVIEW_FINALIZED");
  });
});