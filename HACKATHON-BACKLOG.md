# ESP - Microsoft Global Hackathon 2026 Backlog

Planning baseline: 2026-09-14. This is the project's delivery plan, not an official event requirement or judging rubric. Submission dates, time limits, eligibility, required assets and disclosure requirements must be confirmed with the organizers.

## Outcome And Scope

Demonstrate **Intent -> Governed Capability -> Evidence -> Human Decision -> Evaluated Outcome**, with the same capability reused by independent consumers.

Primary story: a simulated Docker Desktop introduction security review for `SIM-SW-202609-0031`. Security Review is the representative business scenario, not the platform boundary. Existing HR, finance, procurement, security guidance and IT ticket scenarios remain supporting demonstrations and regression coverage.

Confirmed language policy (2026-09-14): English (`en-US`) as the hackathon demo default, with Chinese (`zh-CN`) selectable. Machine identifiers, permissions, workflow states and stored audit codes stay language-neutral.

Priorities:

- **H0**: required for the proposed hackathon story and release acceptance.
- **H1**: valuable enhancements after H0; exclude from the critical path if time is limited.
- **H2**: subsequent platform/product capabilities, not required to pretend the prototype is enterprise-ready.
- **Deferred**: explicit previous scope decisions; not authorization to activate them.

Status legend: **Done** = demonstrated within the stated scope; **Partial** = working slice with stated gaps; **Todo** = not implemented; **Decision** = needs a product or administrative decision. No owner or due date is assigned implicitly. Assign a named owner and evidence link when scheduling each task.

## Verified Starting Point

| Area | Status | Evidence / remaining boundary |
| --- | --- | --- |
| Existing knowledge and ticket runtime | Done in Azure DEV | Seven static Skills, two Plugins, bounded parallel reads, workflow 1.0.3; not a generalized capability marketplace |
| Knowledge quality | Partial | Last deployed run: 57/58; QA-041 unsupported numeric evidence remains. Demo 4/4 and VPN passed; no claim of universal reliability |
| Individual ticket confirmation | Done in tested scope | Bound preview, idempotent persisted receipt, concurrent/replay checks; not exactly-once future external effects |
| Security Review scenario | Partial, Azure DEV deployed | Four fixed simulation branches, deterministic controls, human decision, linked resubmission, history and bilingual report; global capability integration remains D |
| Five review capabilities / four adapters | Partial | Domain-local definitions and in-process implementations, not five independently invocable globally governed Skills |
| Browser + CLI reuse | Done for the workflow | Same HTTP service and review record; not yet an actual Copilot consumer or independent Skill reuse proof |
| Review persistence | Done for bounded DEV verification | Four live Blob reviews and 12 audit pairs unchanged after app restart, including reports/ETags; concurrent identical submission reused one record. Not WORM or universal durability proof |
| Human accountability | Partial | Reasons and actor IDs retained; requester/reviewer deliberately share DEV identity |
| English support | Partial overall, presentation deployed | B01-B07 deployed: employee/management/demo controls, runtime labels, review evidence and reports; original content retained. Live review switching sends zero requests. B08 complete visual/accessibility acceptance remains |
| Validation | Done for current bounded release | 1127 tests / 70 files, lint/build/data/package checks; live health/readiness, four review branches, concurrent submission, bilingual reports and restart comparisons passed. Model-quality suite not rerun; broader G02/B08 remain |

The deployed release is `6421747f-c475-4d2a-9239-d3b16efed4d6`, build `fOzUgq-Cvo9wUrUhmoBau`, deployed with explicit authorization on 2026-09-15. [Manifest](artifacts/azure-workspaces-review-20260915/manifest.json), [runtime checks](artifacts/azure-workspaces-review-20260915/runtime-verification.json), [four-branch checks](artifacts/azure-workspaces-review-20260915/review-verification.json) and [restart comparisons](artifacts/azure-workspaces-review-20260915/restart-verification.json). Previous release `9d70309a-340e-41db-9d72-0d5f275ef7b7` is retained for rollback. The stopped private PostgreSQL server was started with separate user confirmation; running charges resume, without network/SKU changes. No model call, source publication or migration occurred.

## H0 - Hackathon Deliverables

### A. Story, Scope And Release Criteria

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-A01 | Confirm event requirements and delivery schedule | Decision | User will provide official materials later; proceed with independent tasks. No deadline or event time limit assumed |
| H0-A02 | Freeze the primary demo story | Done | [Version 1.0.0 English story](HACKATHON-DEMO.md) covers intent, evidence, human decision, report and honest current/target reuse proof; event timing remains A01 |
| H0-A03 | Define the MVP acceptance matrix | Partial | [SR-01 through SR-16 and release gates](HACKATHON-DEMO.md) drafted; proposed warm latency budgets and bounded run protocol still need agreement |
| H0-A04 | Assign delivery and capability owners | Decision | User explicitly keeps owners unassigned for now; no real role assignment or responsibility inferred |

### B. English-First, Chinese-Compatible Experience

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-B01 | Introduce a shared localization foundation | Done locally | [Locale contract](src/lib/esp/locale.ts), [provider](src/app/locale-provider.tsx), async server cookie selection and shell navigation. English default/invalid-value fallback, Chinese reload persistence and zero POSTs on switching verified; draft/case selection preserved; full page translation remains separate |
| H0-B02 | Translate the complete employee demo journey | Done locally, presentation scope | Review, ticket input/confirmation/receipt/history, approval queue/detail/decisions/events, errors, known Skill metadata, knowledge/parallel/workflow result controls and clarification/no-match guidance are bilingual. Dynamic source/model text remains explicitly identified original content. Mocked ticket/approval/clarification checks preserve drafts, ETags and IDs with zero locale requests. Real cloud and full visual acceptance remain G/B08 |
| H0-B03 | Localize operations and demonstration surfaces | Done locally, presentation scope | Skill/Plugin catalogs, trials, evaluation, workflow launch, knowledge library, Blob sync, source-page, audit, Demo Center and runtime controls localized. Original evidence, cases, business fields, request parameters and audit JSON/export retained. Known runtime labels retain visible step codes; unknown events remain uninterpreted. Locale switching preserves state without requests. Preflight expiration and fresh pre-execution checks unchanged; configuration is not a health probe. Full visual/accessibility and cloud acceptance stay B08/G |
| H0-B04 | Define a consistent English glossary | Done | [Bilingual product glossary](HACKATHON-DEMO.md) defines UI/report/narration meanings, including automated pass vs human approval vs execution and original vs translated evidence |
| H0-B05 | Support English review discovery and follow-ups | Done locally, bounded grammar | [Discovery rules](src/lib/esp/security-review.ts) accept full English review/assessment requests and fixed Chinese equivalents. Negation, extra actions/objects and decision-only text are rejected; discovery and direct start share the same guard. Structured English decisions and linked information follow-ups tested with required ID/ETag/reason and unchanged prior evidence. This is not general conversational understanding |
| H0-B06 | Provide English-readable synthetic evidence | Done locally | [Versioned presentation](src/lib/esp/security-review-presentation.ts) covers all five primary-demo excerpts, including high-risk/conflict variants. Exact original/ID/document/field/value/version matching; labelled English representations alongside unchanged originals; unknown inputs return no translation. Four-case tests verify no mutation |
| H0-B07 | Localize reports and decision history | Done locally | [Standalone bilingual HTML report](src/lib/esp/security-review-report.ts), HTML download, print CSS and original JSON through the same owner-checked GET. Localized UTC dates, findings/evaluation/version labels and labelled system-entry representation; original human reasons/evidence/IDs retained. Four-branch, escaping, permission and unchanged-JSON tests pass; wider visual acceptance remains B08 |
| H0-B08 | Validate both languages and accessibility | Partial | Review/report, mocked knowledge/approval policy/detail and ticket history checked at 1440/390/320 without stable DOM overflow. Ticket/approval drafts, confirmation/ETag/selection IDs survive locale switches with zero requests. Ticket history has keyboard selection buttons; failed reads do not claim empty lists. Full visual/keyboard/contrast and real cloud acceptance remain open; screenshot edge-cropping remains unresolved |

Internationalization is not a bulk translation of JSON evidence. Any bilingual source-pack/index migration is a separately planned publication change, with matching canonical digests and rollback data.

### C. Menus And Business-Oriented Navigation

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-C01 | Introduce three workspaces | Partial, grouped navigation deployed | Employee Workspace, Capability Operations and Demo Center group all ten existing destinations; existing detail callbacks retained, workbench draft preserved, no permission changes. Independent workspace views and unsaved-child-form guards remain |
| H0-C02 | Build the Employee Workspace navigation | Todo | Workbench, My Requests, My Tasks, Knowledge Search; hide technical clutter behind detail views, not by removing necessary evidence |
| H0-C03 | Merge business records into My Requests | Todo | Tickets and security reviews share a list with type/status/date filters and accessible details; approvals can link to their business request; clearly distinguish partial loading from a global search |
| H0-C04 | Build My Tasks from available server actions | Todo | Show actionable approvals, security decisions and requests for information; do not invent an independent reviewer inbox while DEV identity is shared |
| H0-C05 | Separate request creation from request details | Todo | One common detail shell: overview, next action, evidence/findings, workflow/decisions, report/evaluation and audit. Selecting history does not leave a misleading new-request form as the primary view |
| H0-C06 | Group technical management surfaces | Partial, operations group deployed | Existing technical pages grouped under Capability Operations; unified Capability Center/Knowledge & Sources tabs, separate Evaluation & Improvement and Runtime & Audit remain |
| H0-C07 | Move fixture controls into Demo Center | Todo | Demo scenario selection launches the normal employee flow. Employee screen does not permanently require selecting complete/missing/high-risk fixtures; fixture choice remains explicit and traceable |
| H0-C08 | Simplify workbench and mobile navigation | Partial, labelled menu deployed | Collapsible labelled mobile navigation replaces the icon wall; environment/shared-identity warnings retained, 1440/800/390/320 checked. Business-focused detail composition and execution drawer remain |

### D. Governed Capability Integration

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-D01 | Integrate the five security capabilities into the global catalog | Partial | Typed inputs/outputs, version, effect, required permissions, responsible role, examples, evaluation contract and implementation binding; count only executable capabilities, not static labels |
| H0-D02 | Integrate the four review adapters into the Plugin catalog | Partial | Actual registered operation contracts and implementations, safe read trials/write previews, dependency and version metadata; no direct arbitrary endpoint or code execution |
| H0-D03 | Establish one governed invocation boundary | Partial | Browser, CLI and future Copilot cannot bypass permission, validation, confirmation/approval, idempotency or audit by calling a lower-level operation; expose only approved capability operations |
| H0-D04 | Register the review workflow and server-owned plan | Partial | Explicit dependencies and actual stage input/output/status/version/request IDs; current domain-specific workflow no longer sits outside platform discovery; additional tasks cannot be silently discarded |
| H0-D05 | Demonstrate independent capability reuse | Todo | At least one review capability, not just the whole workflow, is called by two consumers through the same governance boundary with the same version and equivalent evidence |
| H0-D06 | Demonstrate compatible version evolution | Todo | Update one capability/rule version without changing consumer code; new runs use it, old records still resolve their original rule/evidence versions. Add compatibility and rollback checks before changing v1 definitions |

The five proposed review capabilities are Intake, Evidence Extraction, Control Check, Risk & Remediation Analysis, and Report Generation. The four current review adapters are Evidence, Controls, Review Records and Reports. These names are this project's proposed MVP design, not an official event specification.

### E. Security Review Business Closure

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-E01 | Preserve the four branch behaviors | Partial | Complete -> human decision; missing -> request information; high-risk/conflict -> blocked approval with explicit resolution path. Current local implementation passes; integrate with D and English B |
| H0-E02 | Make evidence and findings inspectable | Partial | Each finding links exact material ID/version/excerpt and rule; absent evidence remains absent; conflict cannot be resolved by assuming newest wins |
| H0-E03 | Maintain human accountability | Partial | Mandatory reason, actor/time, immutable final decision, stale-state conflict handling; approval is explicitly not installation/licensing authorization; shared-identity limitation visible |
| H0-E04 | Complete linked resubmission UX | Partial | New material creates a linked review, original evidence and decision remain readable; show parent/child relationship and changed evidence rather than implying the old review was repaired |
| H0-E05 | Complete report presentation | Partial | English-readable structured report showing scope, controls, risk/findings, evidence, human decision, evaluation, capability/Plugin/policy versions and limitations; JSON plus usable browser report, optional print layout |
| H0-E06 | Make execution and report history durable | Partial, DEV restart verified | Four Blob reviews/reports/ETags and 12 audit pairs survive restart unchanged. Actual stored stages retained; independently traceable report-render events and global stage contracts remain, without fabricated events |
| H0-E07 | Validate review behavior independently | Partial | Automated scenario expectations separate from the same control function being tested; negative tests for tampering, blocked approval, idempotency, owner isolation, incomplete audit and uncertain writes |

### F. Copilot And Reuse Proof

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-F01 | Select the actual Copilot integration route | Decision | Confirm access, licensing, tenant permissions and chosen Copilot experience; choose supported connector/OpenAPI/custom action or MCP where applicable; do not require MCP merely for its name |
| H0-F02 | Build the consumer adapter and contract | Todo | English discovery/invocation/status/evidence responses through D03; bounded requests, error semantics, version/consumer correlation and no client-provided identity; required infrastructure/IAM approval recorded |
| H0-F03 | Demonstrate Web and Copilot reuse | Todo | Same registered capability and governance work in both experiences; compare Skill/Plugin/rule versions and outcomes; no duplicated domain logic in the Copilot |
| H0-F04 | Preserve human confirmation across consumers | Todo | Copilot cannot turn natural-language intent into an implicit approval or replay mutation on timeout; recovery uses the same server receipt |
| H0-F05 | Keep an honest fallback demo | Partial | CLI/API fallback works if tenant integration is unavailable, but submission explicitly states actual Copilot integration is missing; a COPILOT ENTRY label is not evidence of integration |

### G. Quality, Cloud And Release Acceptance

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-G01 | Resolve the remaining software knowledge failure | Partial | QA-041 numeric evidence failure investigated using scoped evidence; preserve old 57/58 report, do not loosen gates or combine successes across runs |
| H0-G02 | Define and execute a release-quality suite | Partial | Security branches + English intents + existing knowledge baseline/challenge v2 + parallel/VPN/ticket regressions; same release/config/data, full failures retained, no retry-until-green |
| H0-G03 | Assess repeatability and latency | Todo | Agree a bounded repeat-run protocol and cost budget in advance; report per-case variation, refusal/incorrect-answer/transport separation and observed p50/p95. One green run is not a reliability guarantee |
| H0-G04 | Perform targeted human adjudication | Todo | Review main-demo output and sampled edge cases for entity/condition/unit/time-scope correctness; explain deterministic checks versus LLM evaluation and provisional thresholds |
| H0-G05 | Deploy the review increment to Azure DEV | Done, authorized manual release | Release 6421747f deployed from verified local-source package; previous 9d70309a ZIP retained. Healthy dependencies, private Blob review/audit storage, no memory mode/seed/migration. Not CI provenance or automatic deployment |
| H0-G06 | Verify cloud durability and concurrency | Done for bounded synthetic scope | Four labelled synthetic reviews, three blocked approvals, 12 recorded review audits, identical concurrent submission reused. Reports/records/ETags/audits identical after restart; four records only, unrelated data untouched. Shared DEV identity and no WORM claims retained |
| H0-G07 | Rehearse recoverable demonstration failures | Todo | Missing materials, denied action, dependency unavailable, expired/stale client state and uncertain write have clear English outcomes; no fabricated success or automatic business retry |
| H0-G08 | Freeze the demonstrated release | Todo | Exact build/release/data/rule versions, startup/readiness checks, artifact hashes, retained rollback materials and rehearsed operator steps; no last-minute silent data changes |

### H. Hackathon Presentation Package

| ID | Task | Status | Acceptance / dependencies |
| --- | --- | --- | --- |
| H0-H01 | Prepare English pitch and architecture diagram | Todo | Explain problem, capability-centric distinction, architecture and demonstrated value without unsupported product/market claims; verify external Microsoft/competitor references separately |
| H0-H02 | Prepare an English live-demo runbook | Todo | Exact inputs, expected states, human actions, evidence links and reusable capability comparison; timings fit confirmed event limits; show one success and one governance boundary |
| H0-H03 | Record the required video and screenshots | Todo | Actual demonstrated build, readable English UI, synthetic-data notice, no secrets; backup recording labelled as recorded, not passed off as live |
| H0-H04 | Prepare submission and judge-access materials | Todo | English summary, setup/access steps, architecture, demo link, evaluation results and known limitations; verify permission to share repository/artifacts before publication |
| H0-H05 | Make business value measurable | Todo | Separate measured prototype evidence (shared implementations, two consumers, traced decisions) from estimated future savings; do not invent ROI, adoption or production scale |
| H0-H06 | Final claims and safety review | Todo | Five Skills/four Plugins are actual contracts; actual Copilot integration status truthful; no WORM, real reviewer isolation, vendor certification, full autonomy or continuous learning claims unsupported by implementation |

## Recommended Delivery Order

1. **Foundation:** A01-A04; B01/B04 language architecture and glossary; freeze Security Review contracts before translating evidence.
2. **English vertical slice:** B02/B05-B08 with E01-E05. Make one complete English review usable before translating secondary administration pages.
3. **Platform integration:** D01-D04; C01-C05 common navigation and request detail. Preserve existing controls and histories.
4. **Reuse demonstration:** F01-F04 and D05-D06. Begin tenant/access decisions during step 1 because they can block this milestone.
5. **Operations and demo polish:** B03, C06-C08, E06-E07, G01-G08, then H01-H06 on the frozen candidate.

Do not spend the entire hackathon budget chasing 58/58 on unrelated questions while the English Security Review and real reuse story are missing. Equally, do not relabel existing quality failures as resolved: keep them as explicit release risks and apply the agreed acceptance matrix.

## H1 - Enhancements After The Core Demo

| ID | Task | Acceptance |
| --- | --- | --- |
| H1-01 | Trusted evaluation and feedback storage | Persist evaluator provenance and human adjudication, connect a finding to an improvement proposal and owner; imported reports remain untrusted until verified |
| H1-02 | Capability reuse/impact dashboard | Real consumer counts, invocation outcomes, affected dependencies and usage by version, with privacy-aware aggregation |
| H1-03 | Server-side filtering and complete pagination | Tickets, reviews, approvals and audit can be searched across pages; no loaded-page-only filter presented as global |
| H1-04 | Richer request history and progress | Durable task state, accurate running/completed/failed steps, explicit wait cancellation versus server cancellation; no fake streaming |
| H1-05 | Versioned knowledge replacement | Reviewed replacement/supersession, diff, conflict handling and rollback of indexed/canonical evidence together |
| H1-06 | Additional controlled material ingestion | Labelled synthetic upload, size/type checks, evidence provenance and review refresh; PDF/Office/OCR only if needed for the selected story |
| H1-07 | Additional review object or consumer | Reuse existing capability/control contracts, not a copy of the full flow; quantify what was reused |
| H1-08 | Visitor parking discovery vignette | Discover approved service, owner, policy and form/deep link; illustrative secondary story, not a mandatory security MVP requirement |
| H1-09 | IT ticket lifecycle | Assign, progress, request information, resolve, requester confirmation, close/reopen with history; separate from already implemented creation/idempotency |
| H1-10 | Reviewer queue and reminder design | Implement only approved scope; real notification delivery and role separation need separate authorization |

## H2 - Platform Roadmap

- Capability lifecycle: reviewed authoring, publish/deprecate/retire, independent packages, compatibility constraints and consumer-safe rollback.
- Enterprise capability federation across applications, workflows, services and agents; ownership and taxonomy, duplicate-capability detection and gap assessment.
- Multi-tenant/department authorization, real reviewer roles, separation of duties and delegated execution identities.
- Approved external business adapters and MCP support, sandboxing, secrets isolation, policy-bound tool access and failure reconciliation.
- General dependency orchestration, durable queues, overall deadlines, concurrency budgets, cancellation and recovery semantics.
- Signed/trusted evaluation artifacts, independent holdouts, model/version provenance and governed improvement promotion; no autonomous training implied.
- Evidence retention, immutability requirements, recovery drills, compliance review and privileged administrator threat model.
- Production SLOs, cost budgets and value measurement across consumers; operational support and capability owner handoff.

## Explicit Constraints And Deferred Work

- Authentication hardening remains deferred. A real Copilot integration may introduce identity prerequisites: request a scope decision rather than silently changing the shared DEV configuration.
- Keep monitoring portal-only. Do not add notification receivers, scheduled model evaluations or automatic business retries without new approval.
- No automatic Skill/knowledge improvement publication or training. Existing proposals remain export-only until that scope is explicitly changed.
- No Git commit/push, new branch, OIDC identity, repository publication or CI activation without authorization. Existing local pipeline assets do not imply an active deployment pipeline.
- Do not alter model deployment capacity, private service networking or database configuration as a side effect of UI/English work.
- Cloud deployments, source/index publication, migrations and creation of cloud acceptance records need bounded authorization and rollback plans. A previous deployment approval is not blanket permission for all future changes.
- Preserve real-vs-synthetic, local-memory-vs-durable, current-vs-historical and planned-vs-invoked distinctions in both languages.

## Evidence And Completion Rules

For each scheduled task, record: ID, named owner, status, dependency, implementation link, tests, real acceptance artifact (if required), release/version and residual limitation. A task is not done merely because a UI label or static catalog row exists.

The hackathon MVP can be called accepted only when the agreed H0 matrix is satisfied on one identified release, the main English journey is complete, governance boundary tests pass, the declared reuse proof is real, and all unresolved risks are disclosed. This is not a production certification.

Implementation anchors: [workbench](src/app/workbench.tsx), [review core](src/lib/esp/security-review.ts), [review API](src/app/api/security-reviews/route.ts), [global Skill registry](src/lib/esp/registry.ts), [global Plugin registry](src/lib/esp/plugin-registry.ts), [locale root](src/app/layout.tsx), [current implementation and release evidence](README.md).