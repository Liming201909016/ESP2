# ESP Hackathon Demo - Story And Acceptance

Story version: 1.0.0. Planning date: 2026-09-14.
Audience: internal Hackathon 2026 reviewers, colleagues and potential collaborators. English is the confirmed default experience; Chinese remains selectable. Present ESP as an experimental project and enterprise operating-model proposal, not a released product. Event rules and permitted sharing remain subject to organizer confirmation.

## Decisions And Open Inputs

- Primary story: software-introduction Security Review for Docker Desktop, using fixed non-sensitive synthetic materials.
- Primary message: capabilities can be discovered, governed, evaluated and reused independently of the consuming interface.
- AI Readiness final evaluation: Monday, September 21, 2026, per the notice supplied by the project owner. At least one repository must be readable by the scanning identity; see the [scan preparation checklist](README.md#ai-readiness-evaluation---september-21). Exact cutoff/time zone, pitch/video length, other event rules and submission fields remain unconfirmed.
- Delivery and capability owners: unassigned by explicit user choice; assignment remains open.
- Live-demo latency budget: proposed below, not yet agreed. Do not claim H0-A03 fully accepted until this decision is recorded.

## English Narrative

### Bilingual Product Glossary

Use these meanings consistently in UI dictionaries, reports, demo narration and API documentation. Machine codes remain unchanged.

| English | Chinese | Meaning / guardrail |
| --- | --- | --- |
| Intent | 业务意图 | The user's requested outcome, not permission to execute a write |
| Capability | 企业能力 | The reusable business capability, independent of its consumer |
| Skill | 技能 | A governed capability contract with inputs, outputs, version and policy requirements |
| Plugin | 插件 | An approved implementation adapter; not an autonomous decision maker |
| Workflow | 工作流 | A defined sequence/dependency plan using capabilities |
| Consumer | 消费者／调用入口 | A Copilot, app, CLI or service using the governed interface |
| Review | 审查 | A business review of an object and its evidence, not a deployment |
| Finding | 发现项 | A supported observation linked to a control and evidence |
| Control Check | 控制检查 | An automated check; passing it does not imply human approval |
| Evidence | 证据 | Traceable source material; translated presentation is not a replacement original |
| Source | 来源 | The identified document/system supplying evidence, with its version |
| Human Decision | 人工决定 | Explicit reviewer action with actor, time and reason |
| Review Approved | 审查批准 | The review decision only; does not mean software is installed or access is granted |
| Request Information | 要求补充材料 | Preserve the current review and request a linked follow-up, not edit history |
| Evaluation | 评价 | Outcome validation against stated criteria; distinguish it from source review |
| Execution | 执行 | Actual invocation/effect status, not just a selected or planned Skill |
| Audit Record | 审计记录 | Operation accountability metadata, separate from full report/history |
| Report | 报告 | The review's human-readable/exportable evidence, findings and decisions |
| Synthetic Data | 模拟数据 | Fictional demo input, not live enterprise or vendor evidence |
| Shared DEV Identity | DEV 共享身份 | Explicit demonstration limitation, not independent requester/reviewer roles |
| In-memory | 内存保存 | Ephemeral process state, not durable cloud persistence |
| Version | 版本 | Identifies the contract/evidence/rule used, not a quality certification |

### Opening

"Employees think in outcomes, but enterprise capabilities are scattered across systems and agents. ESP connects an employee's intent to a governed capability, with evidence, evaluation and a visible human decision. This demonstration uses a software security review; the reusable capability model is the point, not another standalone security agent."

### Scene 1 - Discover A Capability

Employee request: **Please perform a security review of Docker Desktop for our development team.**

Expected experience: ESP identifies the supported software-review capability, displays its scope and version, and shows the required capability/Plugin plan. Discovery does not create a record or approve anything. The employee explicitly confirms review creation.

Show the five intended capabilities: Intake, Evidence Extraction, Control Check, Risk & Remediation Analysis, Report Generation. Show the four implementation adapters: Evidence, Controls, Review Records, Reports. Until global integration is complete, identify these as the review domain's fixed definitions, not globally independent callable Skills.

### Scene 2 - Evidence Before A Decision

Use the complete synthetic material packet. Inspect the three control areas: commercial-license verification, data-processing scope, and installation/image sources. Open the supporting excerpts, evidence IDs and versions. Show the automatic check result as distinct from human approval.

"A passing control check is not an installation or a production authorization. The evidence and policy version are attached to this review, and a human decision is still required."

### Scene 3 - Human Accountability

The reviewer records a reason and explicitly approves or rejects. Show the actor, time, decision and immutable history. In shared DEV mode, state that requester and reviewer use the same test identity and that production separation of duties is not demonstrated.

Export the review report. Inspect scope, findings, evidence, control results, capability/Plugin/rule versions, human decision and limitations. No software is installed and no real license, account or network permission is changed.

### Scene 4 - Governance Boundary

Run a separate missing-material, high-risk or conflicting-evidence packet. Approval must be blocked. Show the exact blocking control and evidence gap rather than a generic error.

For missing information, request additional material with a reason, then create a linked new review. The old review remains unchanged and accessible. Do not overwrite evidence to turn the original result green.

### Scene 5 - Reuse, Not Copying

Show the same capability and versions from a second consumer. The current implemented proof is a CLI reading/exporting the browser-created review through the same governed HTTP service. The target proof is an actual Copilot consumer invoking a globally registered capability without duplicating domain logic.

Do not substitute the current CLI demonstration for a claim of completed Copilot Studio or MCP integration. If the target integration is unavailable, use the CLI as a labelled fallback and disclose the gap.

### Closing

"ESP makes the capability, its evidence, its governance and its ownership visible across consumers. The prototype demonstrates a controlled review workflow. The next step is independent capability lifecycle management and broader consumer integration, not simply adding more agents."

## Required Scenario Matrix

| ID | Scenario | Required outcome | Verification |
| --- | --- | --- | --- |
| SR-01 | Supported English review request | Correct plan, no write before explicit confirmation | UI + API; verify record count unchanged after discovery |
| SR-02 | Complete synthetic material | All controls pass; status remains awaiting human decision | Deterministic tests + deployed scenario |
| SR-03 | Explicit approval | Reason/actor/time recorded; report available; no real installation claimed | Record, report and audit readback |
| SR-04 | Missing material | Missing evidence visible; approval blocked; request-information action recorded | UI disabled action AND server rejects forced approval |
| SR-05 | High-risk material | Failing control and risk visible; approval blocked | Server negative test + review report |
| SR-06 | Conflicting evidence | Both sources visible; no implicit newest-wins decision | Evidence references and conflict outcome |
| SR-07 | Linked resubmission | New review points to old review; old record remains unchanged | Read both records and compare original evidence/history |
| SR-08 | Duplicate or concurrent start | One review per owner/submission/input; changed input conflicts | Concurrent API test + count/readback |
| SR-09 | Stale or repeated decision | Stale incompatible decision rejected; identical completed action reuses result | ETag tests and audit distinction |
| SR-10 | Unsupported/negated/mixed request | No silent subset execution, no guessed review | English and Chinese boundary tests |
| SR-11 | Owner/permission boundary | Inaccessible review not returned; no unauthorized mutation | Server tests; label shared DEV limitation |
| SR-12 | Audit/storage failure | Mutation does not start without audit; uncertain writes never reported as success | Fault-injection tests; no blind automatic replay |
| SR-13 | Cross-consumer reuse | Same service/capability versions and compatible results; no duplicate business implementation | Web + CLI now; actual Copilot before claiming target integration |
| SR-14 | English/Chinese switch | Correct labels/lang; original evidence and signed reasons unchanged; no write replay | SSR/hydration + browser interaction tests |
| SR-15 | Refresh/restart | Deployed Blob review/report/audit survive restart | Live cloud verification; memory demo explicitly excluded |
| SR-16 | Version evolution | New runs use new version, old evidence/decisions still resolve original version | Compatibility and retained-version tests before claiming completion |

## Release Gates

The following are project-proposed acceptance gates, not official judging criteria:

- All mandatory security/governance boundary tests pass; no unsafe approval, identity substitution, fabricated business effect or invalid evidence is accepted.
- The primary English journey is complete, with no unexplained mixed-language controls. Source quotations and original human reasons may retain their language with clear provenance.
- All SR scenarios applicable to the declared implementation pass on one release. Missing Copilot, cloud durability or version-evolution proof is disclosed as a gap, not marked passed by a static UI label.
- Existing knowledge suite (baseline and challenge v2), demo suite and VPN/ticket regressions run with unchanged criteria and all failures retained. The current 57/58 result remains unresolved; do not merge passes from different runs.
- A named human checks the main-demo reports and selected edge cases for entity, unit, condition, scope and time correctness. Deterministic control results are not vendor certification.
- Test results, UI inspection, release/config/data/rule versions and artifact links are recorded together. No case-specific retry-until-green protocol is allowed.

### Proposed Performance Budget - Decision Required

Measure after a separate cold-start readiness check. Suggested warm targets: catalog/discovery under 3 seconds, fixed deterministic review creation/decision under 5 seconds, report retrieval under 3 seconds. For model-backed supporting questions, propose an observed p95 under 20 seconds, with failures and throttles reported separately. Confirm or replace these numbers before timed acceptance; they are neither measured current guarantees nor official event limits.

Once approved, specify a bounded run count and model cost budget in advance. Record per-case durations and p50/p95; do not remove slow or failed attempts. Present cold-start time separately. Any timeout or limit change requires a documented reason and a new comparable report.

## Rehearsal And Evidence Checklist

- [ ] Official event constraints recorded and the script fitted to the actual allotted time.
- [ ] Named narrator, operator, technical owner and backup operator assigned.
- [ ] English UI, reports and source-language explanations verified on desktop and mobile.
- [ ] Primary success and one governance-blocked branch rehearsed on the frozen build.
- [ ] Reuse proof matches the actual consumer integrated, with explicit fallback disclosure.
- [ ] Deployed persistence, audit links and download checked; local memory is never called durable.
- [ ] Safe backup recording/screenshots retained and labelled recorded if used.
- [ ] Known limitations and remaining quality failures included in submission materials.

Implementation status and task ownership: [Hackathon backlog](HACKATHON-BACKLOG.md). Current local review behavior and cloud release evidence: [README](README.md).