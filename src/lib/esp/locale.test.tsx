import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { localePreferenceCookie, messages, resolveLocale, translate } from "./locale";
import { LanguageSelector, LocaleProvider } from "../../app/locale-provider";
import { SecurityReviewPanel } from "../../app/security-review-panel";
import { SkillUsagePanel } from "../../app/skill-usage";
import { discoverSecurityReview } from "./security-review";
import { IntentChoiceForm, TicketDetailsForm } from "../../app/request-input";
import { approvalMessage, approvalPolicyReason, PolicyApprovalsView } from "../../app/policy-approvals";
import { ticketApprovalPolicy } from "./approval-policy";
import { approvalStatusSchema, approvalActionSchema, approvalRecordSchema } from "./approval-contracts";
import { presentedOperationName, presentedSkillDescription, presentedSkillName } from "./skill-presentation";
import { skillRegistry } from "./registry";
import { SkillCatalogView } from "../../app/skill-catalog";
import { WorkflowPanel, workflowErrorKey, workflowRequestText } from "../../app/workflow-panel";
import { workflowRequestSchema, ticketGuidanceWorkflow } from "./workflow-contracts";
import { ticketIdsInQuery } from "./ticket-input";
import { KnowledgeImportForm, knowledgeAreas, knowledgeRequestMessage } from "../../app/knowledge-import";
import { KnowledgeLibraryView } from "../../app/knowledge-library";
import { libraryMessages, libraryText, libraryErrorKey } from "./knowledge-library-locale";
import { libraryItemSchema } from "./knowledge-library-contracts";
import { KnowledgeSourceView } from "../../app/knowledge-source";
import { DemoPanel } from "../../app/demo-panel";
import { demoText } from "./demo-locale";
import { demoRequest } from "./demo";
import { SimulationCaseLibrary } from "../../app/simulation-cases";
import { simulationCases } from "./simulation-cases";
import { RuntimeTrace, runtimeIdentityLabel, runtimeTraceLabel } from "../../app/runtime-context";
import { WorkspaceNavigation } from "../../app/workbench";

describe("locale foundation", () => {
  it.each(["en-US", "zh-CN"] as const)("groups all existing destinations without invoking navigation in %s", (locale) => {
    let calls = 0;
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><WorkspaceNavigation activeView="audit" onSelect={() => { calls += 1; }} /></LocaleProvider>);
    expect(html.match(/class="workspace-nav-group"/g)).toHaveLength(3);
    expect(html.match(/class="nav-item(?: active)?"/g)).toHaveLength(10);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(locale === "en-US" ? "Capability Operations" : "能力运营");
    expect(html).toContain(translate(locale, "audit"));
    expect(html).toContain('<details class="workspace-menu" open="">');
    expect(calls).toBe(0);
  });
  it.each(["en-US", "zh-CN"] as const)("labels runtime events without changing original evidence in %s", (locale) => {
    const trace = ["request.validated", "execution.awaiting_confirmation", "approval.approved", "parallel.partial", "execution.failed", "future.step.<script>", "__proto__", "toString"].map((step) => ({ step, at: "2026-09-15T02:00:00.000Z" }));
    const before = JSON.stringify(trace);
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><RuntimeTrace trace={trace} /></LocaleProvider>);
    expect(html.match(/class="trace-item"/g)).toHaveLength(trace.length);
    expect(html.match(/dateTime="2026-09-15T02:00:00.000Z"/gi)).toHaveLength(trace.length);
    for (const item of trace.slice(0, 5)) {
      expect(html).toContain(runtimeTraceLabel(locale, item.step));
      expect(html).toContain(`<code>${item.step}</code>`);
    }
    expect(html).toContain("future.step.&lt;script&gt;");
    expect(html).not.toContain("<script>");
    for (const item of trace.slice(5)) expect(runtimeTraceLabel(locale, item.step)).toBe(item.step);
    expect(runtimeIdentityLabel(locale, "development")).toBe(translate(locale, "sharedIdentity"));
    expect(runtimeIdentityLabel(locale, "none")).not.toBe(runtimeIdentityLabel(locale, "entra"));
    expect(JSON.stringify(trace)).toBe(before);
    const empty = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><RuntimeTrace /></LocaleProvider>);
    expect(empty).toContain(translate(locale, "noExecutions"));
    expect(empty).not.toContain('class="trace-item"');
  });
  it.each(["en-US", "zh-CN"] as const)("renders demo safeguards and original request in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><DemoPanel pending={false} onRun={() => undefined} /></LocaleProvider>);
    expect(html).toContain(demoText(locale, "unchecked"));
    expect(html).toContain(demoText(locale, "unconfirmed"));
    expect(html).toContain(demoText(locale, "request"));
    expect(html).toContain(demoRequest("DEMO-001").query);
    expect(html).not.toContain(demoText(locale, "passed"));
    expect(html).toMatch(/class="case-run" type="button" disabled=""/);
    const selected = simulationCases[0];
    const library = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><SimulationCaseLibrary selectedId={selected.id} onSelect={() => undefined} onRun={() => undefined} pending={true} onRunRequest={() => undefined} onOpenAudit={() => undefined} onQuery={() => undefined} onPrepare={() => undefined} onOpenRecords={() => undefined} /></LocaleProvider>);
    expect(library).toContain(demoText(locale, "library"));
    expect(library).toContain(demoText(locale, "answerReference"));
    expect(library).toContain(selected.query);
    expect(library).toContain(selected.expectedAnswer);
    expect(library).toContain('value="no_evidence"');
    expect(library).toMatch(/class="case-run" type="button" disabled=""/);
  });
  it.each(["en-US", "zh-CN"] as const)("localizes source metadata without rewriting original evidence in %s", (locale) => {
    const source = { id: "dev-source-test", title: "Original 标题", organization: "澄川数科（虚构组织）" as const, documentNumber: "SIM-SOURCE-001", owner: "Original owner", dataKind: "snapshot" as const, effectiveDate: "2026-09-15", version: "test-v1", section: "Original section", content: "Original evidence 原始证据\n<script>not executable</script>" };
    const before = JSON.stringify(source);
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><KnowledgeSourceView source={source} /></LocaleProvider>);
    expect(html).toContain(translate(locale, "sourceWorkbench"));
    expect(html).toContain(translate(locale, "sourceSynthetic"));
    expect(html).toContain(libraryText(locale, "snapshotDate"));
    expect(html).toContain(translate(locale, "reviewOriginal"));
    expect(html).toContain(source.title);
    expect(html).toContain("Original evidence 原始证据\n&lt;script&gt;not executable&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toMatch(/dateTime="2026-09-15"/i);
    expect(html).toContain('href="/"');
    expect(JSON.stringify(source)).toBe(before);
  });
  it.each(["en-US", "zh-CN"] as const)("renders knowledge-library loading and unchanged filter codes in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><KnowledgeLibraryView selectedId={null} onSelect={() => undefined} onTest={() => undefined} /></LocaleProvider>);
    expect(html).toContain(libraryText(locale, "loading"));
    expect(html).not.toContain(libraryText(locale, "noMatches"));
    expect(html).toContain('value="imported"');
    for (const status of libraryItemSchema.shape.status.options) expect(html).toContain(libraryText(locale, status));
  });
  it.each(["en-US", "zh-CN"] as const)("renders import safeguards and stable field values in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><KnowledgeImportForm onSaved={() => undefined} onCancel={() => undefined} /></LocaleProvider>);
    expect(html).toContain(libraryText(locale, "documentTitle"));
    expect(html).toContain(libraryText(locale, "simulatedCheck"));
    expect(html).toContain(libraryText(locale, "preview"));
    expect(html).toContain('pattern="SIM-(?:[A-Z0-9]|-){3,60}"');
    expect(html).toContain('value="policy" selected=""');
    expect(html).toMatch(/type="checkbox" required=""/);
    expect(html).toMatch(/class="kb-primary" type="button" disabled=""/);
    for (const area of Object.keys(knowledgeAreas)) expect(html).toContain(`value="${area}"`);
  });
  it("has complete library translations and safely rejects unknown error codes", () => {
    for (const pair of Object.values(libraryMessages)) {
      expect(pair.every((value) => value.trim().length > 0)).toBe(true);
      expect(pair[0]).not.toMatch(/[\u4e00-\u9fff]/);
    }
    for (const code of [undefined, null, {}, "PRIVATE_RAW_ERROR", "__proto__", "toString"]) expect(libraryErrorKey(code)).toBe("unavailable");
    expect(knowledgeRequestMessage("INDEX_PUBLISH_FAILED", "en-US")).toContain("draft is retained");
    expect(knowledgeRequestMessage("INDEX_CLEANUP_FAILED", "en-US")).toContain("document is inactive");
    expect(knowledgeRequestMessage("AUDIT_START_FAILED", "en-US")).toContain("no document was written");
    expect(knowledgeRequestMessage("PRIVATE_RAW_ERROR", "en-US")).not.toContain("PRIVATE_RAW_ERROR");
  });
  it.each(["AUDIT_START_FAILED", "INVALID_REQUEST", "DOCUMENT_TOO_LARGE", "DEV_MANAGEMENT_REQUIRED", "PERMISSION_REQUIRED", "AUTHENTICATION_REQUIRED", "CONFLICT", "BUSY", "INDEX_PUBLISH_FAILED", "INDEX_CLEANUP_FAILED", "NOT_FOUND"])("maps the library error %s without changing its machine code", (code) => {
    expect(libraryErrorKey(code)).toBe(code);
    expect(knowledgeRequestMessage(code, "en-US")).not.toBe(knowledgeRequestMessage("unknown", "en-US"));
  });
  it.each(["en-US", "zh-CN"] as const)("renders workflow loading and preserves ticket identifiers in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><WorkflowPanel pending={false} onOpenAudit={() => undefined} /></LocaleProvider>);
    expect(html).toContain(translate(locale, "workflowLoading"));
    expect(html).toContain(translate(locale, "workflowRefresh"));
    expect(html).not.toContain(translate(locale, "workflowNone"));
    expect(html).not.toContain('<form');
    const id = "ESP-20260911-03CE94E1";
    const query = workflowRequestText(locale, id);
    expect(workflowRequestSchema.parse({ workflowId: ticketGuidanceWorkflow.id, query }).query).toBe(query);
    expect(ticketIdsInQuery(query)).toEqual([id]);
    expect(ticketIdsInQuery(workflowRequestText(locale))).toEqual([]);
    if (locale === "en-US") expect(query).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it("maps workflow errors to stable keys and never echoes unknown failures", () => {
    expect(workflowErrorKey("AUTHENTICATION_REQUIRED")).toBe("workflowError_access");
    for (const code of ["PERMISSION_REQUIRED", "SUBJECT_REQUIRED"]) expect(workflowErrorKey(code)).toBe("workflowError_permission");
    expect(workflowErrorKey("INVALID_WORKFLOW_REQUEST")).toBe("workflowError_input");
    for (const code of [undefined, null, "PRIVATE_ERROR_BODY", "__proto__", {}]) expect(workflowErrorKey(code)).toBe("workflowError_result");
    expect(translate("en-US", "workflowError_transport")).toContain("may still be running");
    expect(translate("en-US", "workflowError_result")).toContain("not automatically rerun");
  });
  it.each(["en-US", "zh-CN"] as const)("renders catalog filters and loading without inventing an empty result in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><SkillCatalogView selectedId={null} onSelect={() => undefined} onTry={() => undefined} onOpenCase={() => undefined} executionPending={false} /></LocaleProvider>);
    expect(html).toContain(translate(locale, "catalogLoading"));
    expect(html).toContain(translate(locale, "catalogSearch"));
    expect(html).toContain(translate(locale, "catalogAllCategories"));
    expect(html).toContain(translate(locale, "catalogAllConfirmations"));
    expect(html).toContain(translate(locale, "catalogAllImplementations"));
    expect(html).not.toContain(translate(locale, "catalogNoSkills"));
    expect(html).toContain('value="required"');
    expect(html).toContain('value="implemented"');
  });
  it("translates known registry versions without changing original metadata or guessing unknown versions", () => {
    const before = JSON.stringify(skillRegistry);
    for (const skill of skillRegistry) {
      expect(presentedSkillName(skill, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
      expect(presentedSkillDescription(skill, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
      expect(presentedSkillName(skill, "zh-CN")).toMatch(/[\u4e00-\u9fff]/);
      expect(presentedSkillName({ ...skill, version: "unknown" }, "zh-CN")).toBe(skill.name);
      expect(presentedSkillName({ ...skill, version: "unknown" }, "en-US")).toBe(skill.name);
      expect(presentedSkillDescription({ ...skill, description: "Unknown original" }, "en-US")).toBe("Unknown original");
    }
    expect(JSON.stringify(skillRegistry)).toBe(before);
    expect(presentedOperationName({ operationId: "tickets.create", operationName: "创建工单", version: "0.1.0" }, "en-US")).toBe("Create ticket");
    expect(presentedOperationName({ operationId: "tickets.create", operationName: "Changed original", version: "0.1.0" }, "en-US")).toBe("Changed original");
  });
  it.each(["en-US", "zh-CN"] as const)("renders approval loading and every status/action/event label in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><PolicyApprovalsView selectedId={null} onSelect={() => undefined} onPrepare={() => undefined} onQueryTicket={() => undefined} executionPending={false} /></LocaleProvider>);
    expect(html).toContain(translate(locale, "approvalLoading"));
    expect(html).not.toContain(translate(locale, "approvalEmpty"));
    for (const status of approvalStatusSchema.options) expect(html).toContain(translate(locale, `approvalStatus_${status}`));
    for (const action of approvalActionSchema.shape.action.options) expect(translate(locale, `approvalAction_${action}`)).not.toBe("");
    for (const event of approvalRecordSchema.shape.events.element.shape.action.options) expect(translate(locale, `approvalEvent_${event}`)).not.toBe("");
  });
  it("translates exact versioned approval rules without changing the original or guessing new versions", () => {
    for (const rule of ticketApprovalPolicy.rules) {
      const policy = { policyId: ticketApprovalPolicy.id, version: ticketApprovalPolicy.version, ruleId: rule.id, reason: rule.reason };
      const before = JSON.stringify(policy);
      expect(approvalPolicyReason(policy, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
      expect(approvalPolicyReason(policy, "zh-CN")).toBe(rule.reason);
      expect(approvalPolicyReason({ ...policy, version: "2.0.0" }, "en-US")).toBe(rule.reason);
      expect(approvalPolicyReason({ ...policy, reason: "Changed original" }, "en-US")).toBe("Changed original");
      expect(JSON.stringify(policy)).toBe(before);
    }
  });
  it.each(["STATE_WRITES_PAUSED", "POSTGRES_COMMIT_UNCERTAIN", "AUDIT_START_FAILED", "CONFLICT", "SUBMISSION_CONFLICT", "APPROVAL_EXPIRED", "INVALID_TRANSITION", "EXECUTION_BUSY", "DEV_REVIEW_REQUIRED", "NOT_FOUND", "PERMISSION_REQUIRED", "AUTHENTICATION_REQUIRED", "POLICY_CHANGED", "APPROVAL_INPUT_CHANGED", "APPROVAL_TICKET_CONFLICT", "INVALID_REQUEST", "EXECUTION_UNCERTAIN", "INVALID_RESPONSE", "REQUEST_TIMEOUT"])("provides an English approval failure for %s", (code) => {
    expect(approvalMessage(code, "en-US")).not.toMatch(/[\u4e00-\u9fff]/);
    expect(approvalMessage(code, "en-US")).not.toBe(approvalMessage("unknown", "en-US"));
  });
  it("does not expose unknown approval failures or inherited object properties", () => {
    for (const code of ["private provider body", "toString", "__proto__", {}, null]) {
      expect(approvalMessage(code, "en-US")).toContain("Refresh the record");
      expect(approvalMessage(code, "zh-CN")).toContain("刷新记录");
    }
    expect(approvalMessage("POSTGRES_COMMIT_UNCERTAIN", "en-US")).toContain("do not create another ticket");
    expect(approvalMessage("EXECUTION_UNCERTAIN", "en-US")).toContain("same ticket ID");
  });
  it.each(["en-US", "zh-CN"] as const)("localizes ticket labels but preserves draft values and choice IDs in %s", (locale) => {
    const parameters = { description: "原始问题 Original issue", device: "SIM-LT-0042", impact: "team" as const };
    const before = JSON.stringify(parameters);
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><TicketDetailsForm parameters={parameters} pending={false} onContinue={() => undefined} /><IntentChoiceForm question="Original question 原文" choices={[{ id: "create-it-ticket", name: "Original choice" }]} pending={false} onSelect={() => undefined} /></LocaleProvider>);
    expect(html).toContain(translate(locale, "ticketDetails"));
    expect(html).toContain(translate(locale, "ticketPrepareConfirmation"));
    expect(html).toContain(translate(locale, "impact_organization"));
    expect(html).toContain('<option value="team" selected="">');
    expect(html).toContain('value="create-it-ticket"');
    expect(html).toContain(parameters.description);
    expect(html).toContain("Original question 原文");
    expect(JSON.stringify(parameters)).toBe(before);
  });
  it.each(["en-US", "zh-CN"] as const)("renders the review entry and discoverable default in %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><SecurityReviewPanel onOpenAudit={() => undefined} /></LocaleProvider>);
    expect(html).toContain(translate(locale, "reviewTitle"));
    expect(html).toContain(translate(locale, "reviewDiscover"));
    expect(html).toContain(translate(locale, "reviewCase_missing"));
    expect(html).toContain(translate(locale, "reviewLoading"));
    expect(html).not.toContain(translate(locale, "reviewEmpty"));
    expect(discoverSecurityReview(translate(locale, "reviewDefaultQuery"))?.workflowId).toBe("software-security-review");
  });
  it.each([
    [false, false, "No Skill selected yet"],
    [true, false, "Checking Skills and execution results"],
    [false, true, "No Skill record received"],
  ] as const)("renders English pending=%s failed=%s without inventing invocation", (pending, failed, message) => {
    const html = renderToStaticMarkup(<LocaleProvider><SkillUsagePanel report={null} pending={pending} failed={failed} awaitingSelection={false} onOpenSkill={() => undefined} onOpenPlugin={() => undefined} /></LocaleProvider>);
    expect(html).toContain(message);
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it("uses English by default and accepts only the supported Chinese locale", () => {
    for (const value of [undefined, null, "en-US", "fr", "zh", "zh-CN; Path=/secret", {}]) expect(resolveLocale(value)).toBe("en-US");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
  });
  it("has identical complete nonempty dictionary keys", () => {
    expect(Object.keys(messages["en-US"]).sort()).toEqual(Object.keys(messages["zh-CN"]).sort());
    for (const dictionary of Object.values(messages)) expect(Object.values(dictionary).every((value) => value.trim().length > 0)).toBe(true);
    expect(translate("en-US", "security")).toBe("Software Review");
    expect(translate("zh-CN", "security")).toBe("软件引入审查");
    expect(translate("en-US", "records")).toBe("IT Tickets");
    expect(translate("zh-CN", "approvals")).toBe("工单策略与审批");
  });
  it("builds a bounded non-authorizing preference cookie", () => {
    expect(localePreferenceCookie("zh-CN", true)).toBe("esp-locale=zh-CN; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(localePreferenceCookie("en-US", false)).not.toContain("Secure");
  });
  it.each(["en-US", "zh-CN"] as const)("renders the server-selected locale without reading browser state: %s", (locale) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><LanguageSelector /></LocaleProvider>);
    expect(html).toMatch(new RegExp(`<option value="${locale}"[^>]* selected=""`));
    expect(html).toContain(`aria-label="${locale === "en-US" ? "Language" : "语言"}"`);
  });
});