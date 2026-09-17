# ESP Hackathon Demo - Story And Acceptance

Story version: 1.2.0. Planning date: 2026-09-17.
Audience: internal Hackathon 2026 reviewers, colleagues and potential collaborators. English is the confirmed default experience; Chinese remains selectable. Present ESP as an experimental project and enterprise operating-model proposal, not a released product. Event rules and permitted sharing remain subject to organizer confirmation.

## Decisions And Open Inputs

- Primary story: software-introduction Security Review for Docker Desktop, using fixed non-sensitive synthetic materials.
- Primary message: the target is independently reusable governed capabilities. Current proof is workflow-level Web/CLI review reuse plus a separate verified Web-to-MCP repository-governance path, not five independent review Skills or completed Microsoft 365 Copilot integration.
- AI Readiness final evaluation: Monday, September 21, 2026, per the notice supplied by the project owner. At least one repository must be readable by the scanning identity; see the [scan preparation checklist](README.md#ai-readiness-evaluation---september-21). Exact cutoff/time zone, pitch/video length, other event rules and submission fields remain unconfirmed.
- Delivery and capability owners: unassigned by explicit user choice; assignment remains open.
- Live-demo latency budget: proposed below, not yet agreed. Do not claim H0-A03 fully accepted until this decision is recorded.

## Current Primary Path - September 17

This is the recommended path for the next rehearsal. The earlier narratives below remain alternate presenter material, not additional scenes to concatenate into this path. Six minutes is a planning budget, not an official event limit or measured execution guarantee.

**平台目标：企业复用的资产是带契约、治理、证据和评价的能力，而不是某个聊天界面或单一 Agent。** 软件引入审查是展示这个目标的具体业务窗口，不是平台边界。

业务故事：研发团队需要引入 Docker Desktop 开展试点，申请材料缺少数据范围说明。员工要知道补什么，审查人要知道凭什么决定，后续复核者要知道当时用了哪一版证据。

| 时间      | 操作路径                                                              | 要证明的价值                             | 可核验证据                                                      |
| --------- | --------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| 0:00–0:35 | 工作台说明需求，输入 `Security review of Docker Desktop`              | 从员工目标出发，不要求员工先理解系统术语 | 原始请求；固定支持范围                                          |
| 0:35–1:15 | 进入 Security Review，发现计划，选择 `missing`，显式确认创建          | 发现与授权分离                           | 五个域内阶段、版本；确认前没有新审查                            |
| 1:15–2:00 | 展示数据范围证据缺失和批准阻断                                        | 证据不足不生成许可结论                   | SIM-CTRL-DATA 为 missing；批准不可用                            |
| 2:00–3:10 | 人工填写补件理由并要求补充；准备关联补件，选 `complete`，单独确认创建 | 业务继续推进，但不改写历史               | 两个不同记录 ID；previousReviewId；旧记录保持 needs_information |
| 3:10–4:10 | 查看新检查结果，操作者自行核对并明确决定                              | 自动检查不等于业务批准                   | 新记录先为 awaiting_decision；人工理由、时间和状态              |
| 4:10–5:10 | 打开同一审查的报告与审计                                              | 结果可解释、可追责                       | 原始摘录、规则/能力/适配器版本和审计关联                        |
| 5:10–6:00 | 回到平台命题，讲清已证明与待证明部分                                  | 从单次流程上升到企业能力资产             | 当前是固定流程；独立 Skill 生命周期和更多消费者仍待完善         |

开场：“员工想解决的是能不能开展试点，而不是该找哪个 Agent。ESP 希望把这个意图连接到边界明确的能力。今天先看材料不足时系统如何停下来，再看补件后如何得到一个有依据、有人负责的决定。”

收尾：“这个示例证明的是治理闭环，不是所有能力已经任意组合。我们希望把这些契约、实现、证据和评价沉淀成可复用的企业资产。当前五个审查阶段仍属于固定领域流程，申请人与审查人使用共享 DEV 身份，批准不代表已安装软件或获得真实上线许可。”

### Separate Technical Extension

- 预留 60–90 秒，不占主故事：展示同一 review ID 的 Web 报告和现有 CLI 读取/导出，作为**工作流级复用**；当前 CLI 没有独立帮助模式，使用下方已对照源码的参数，不临场猜命令。
- 另一独立加演是 Skill Catalog → Repository governance：授权后仅调用一个只读 MCP 工具一次，展示来源、manifest 绑定与审计。七个业务 Skill 与两个治理 Skill 不包含五个独立审查 Skill。
- 不把不同领域的治理 MCP 工具冒充安全审查的第二消费者；验证计划不是命令执行，打包快照不是实时扫描。
- 预算紧时只讲主线。三分钟版应使用明确标注的既有记录或离线材料说明补件，不声称在三分钟内现场完成所有写入和人工审查。

只读加演命令，变量由操作者指定为当前授权 demo 环境和刚展示的真实记录 ID：

```powershell
node scripts/security-review-client.mjs $demoOrigin get $reviewId
node scripts/security-review-client.mjs $demoOrigin export $reviewId artifacts/review-reuse-report.json
```

导出文件必须不存在；不要通过重复创建审查来模拟复用。核对相同记录 ID、policyVersion、原始 evidence 和 history，而不仅仅比较页面标题。当前客户端没有提供独立 Entra 登录流程，不能据此宣称生产多身份消费者集成。

### UI Review And Acceptance Plan

以下是验收清单，当前本地修复进度见后文；未部署事项不能视为线上验收通过。保留机器 ID、历史记录、人工确认、权限及审计门禁；不通过隐藏失败或删除测试记录美化演示。

| 优先级 | UI 调整                                          | 验收条件                                                                                                       |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| P0     | 保留当前审查与补件上下文；审计页提供明确返回路径 | 准备补件或填写理由后跨菜单返回，选中 ID、关联 ID、材料和理由仍一致；过期 ETag 仍由服务端拒绝；不得自动重放请求 |
| P0     | 补件动作后定位创建区                             | 显示关联旧记录、完整材料选择与待确认按钮；焦点和滚动位置进入可见创建区；点击准备不发送创建请求                 |
| P0     | 区分发现、执行和人工决定的按钮语义               | 普通知识请求不能用“仅发现”标签掩盖模型调用；审查入口不出现无法理解的双重发现；写入仍需要单独确认               |
| P1     | 精选演示入口优先展示软件引入故事                 | 一个明确入口进入主场景；知识问答案例库仍可访问；打开演示入口不调用模型、不创建审查                             |
| P1     | 导航名称与实际范围一致                           | 软件引入审查、IT 工单、工单策略与审批三个目的地不互相误导；审查决定仍在审查详情中                              |
| P1     | Skill 展示名区分查询、审查与快照                 | 保留稳定 ID/版本；信息安全规范查询不等于软件审查；仓库治理读的是快照；不增加虚构的已注册 Skill 数              |
| P1     | 报告、结果、审计之间连续导航                     | 原始 JSON 与证据不因语言/页签变化被改写；治理结果跨审计返回后无需重新执行                                      |
| P2     | 演示筛选、状态与移动端                           | 精选标签或筛选避开技术测试噪音，不删历史；英文/中文、1440/390/320px 无溢出；错误和加载状态可辨识               |

### Multi-round Review Gates

1. **目标轮**：逐场景对照 README 的 Intent → Skill → Plugin → Action → Evidence → Evaluation → Accountability；不展示不能回答业务问题的菜单。当前主路径完成静态映射，独立能力复用不列为已验收。
2. **流程轮**：对照实际组件检查输入、补件、返回和按钮动作。此前线上只读复查已复现补件按钮不定位、跨菜单丢上下文；本地修复和浏览器回归见后文，线上仍需部署后复验。业务层测试可验证关联记录和阻断，但不能替代 UI 连续性验收。
3. **反例轮**：运行已有本地审查领域、服务与 UI 测试，核对缺失/冲突/高风险阻断、原始证据、人工决定、并发与陈旧状态保护。测试结果与实际命令分开记录，不借模型生成解释代替断言。
4. **冻结版本彩排轮（待执行）**：P0 修复后，固定 release/build、数据包、语言与时间预算，完整跑一次缺失到关联补件路径，记录两条审查 ID、决定、报告与审计；一次失败保留证据并停止盲目重试。云端写入及部署需另行明确授权，人工决定由操作者完成。

退出条件：P0 全部通过，主线不丢上下文、不误触执行；报告与审计可往返；完整彩排在约定预算内完成。本地回归不能替代冻结版本的计时彩排，不能宣布现场演示已流畅验收。

### Review Record - September 17

- 目标轮：已对照 README 确认主命题为可复用的受治理能力；主故事不扩大为软件安装、采购付款或生产许可。
- 流程轮：已对照 Workbench、SecurityReviewPanel、SimulationCaseLibrary 的实际状态与导航实现；沿用同日线上只读复查的可复现结果，本轮没有重新部署或执行云端审查写入。P0 仍未修复。
- 反例轮：本轮运行以下四个现有测试文件，**84 项通过**；包括完整的本地关联补件规则测试。UI 测试通过不代表已覆盖跨菜单草稿保留或计时彩排。

```powershell
npm test -- src/lib/esp/security-review.test.ts src/lib/esp/security-review-service.test.ts src/app/security-review-panel.test.tsx src/app/governance-skills.test.tsx --maxWorkers=2
```

- 本轮文档检查通过；未重新执行 CodeBlend、模型问答、云端部署或人工审批。性能预算、现场操作者及冻结版本彩排仍待确认。

### Local P0 Follow-up - September 17

上述 84 项测试是规划轮的历史结果。后续本地代码已补上三个 P0 修复，并增加生产构建下的合成响应浏览器回归；尚未部署到 Azure。

- 审查和技能目录首次访问后保留在当前页面会话，跨菜单返回时审查选择、理由、关联补件材料及治理结果保留。不会在离开菜单时取消并重放请求；进行中的操作可能继续完成。浏览器刷新仍会清除未提交的内存草稿，不提供跨登录持久保存。
- 从审计回执打开审计页后，可用 `Return to` 返回原工作区，无需重新执行治理工具。返回不自动刷新权限或服务端版本；后续明确操作仍由服务端校验权限、ETag 和最终状态，保留冲突处理规则。
- `Prepare linked follow-up review` 只设置关联与完整材料，随后滚动到表单并聚焦材料选择；仍需单独点击 `Confirm synthetic review` 才创建记录。
- 工作台识别到支持的审查请求时显示 `Open software review`，只打开新审查入口；普通请求显示 `Process request`，不再声称只是发现。打开新请求会重置旧审查草稿，想继续旧审查应使用侧栏返回。审查页保留 `Discover review capabilities` 和独立确认创建步骤。
- 浏览器回归覆盖跨菜单保留理由与补件关联、隐藏页面不暴露重复控件、准备补件无 POST、新请求无旧关联，以及治理结果从审计返回后不重复调用。缺失材料的批准按钮仍禁用。

后续仍需：明确授权下的完整业务写入、报告与审计读取、冻结版本计时彩排。自动化测试中的合成回执不是云端审批或审计验收证据。

### Local UI And Copy Follow-up - September 17

本地界面增加了精选软件引入审查入口，并完成以下展示调整；未部署前，云端旧版本仍使用原菜单名称。

| 原菜单                            | 本地新菜单                                   | 范围                                     |
| --------------------------------- | -------------------------------------------- | ---------------------------------------- |
| Security Review / 安全审查        | Software Review / 软件引入审查               | 固定模拟软件审查流程                     |
| Execution Records / 执行记录      | IT Tickets / IT 工单                         | 当前身份的工单，不是全部执行记录         |
| Policies & Approvals / 策略与审批 | Ticket Policies & Approvals / 工单策略与审批 | 工单影响范围策略与审批，不含软件审查决定 |
| Demo Cases / 模拟案例             | Demo Center / 演示中心                       | 精选审查入口、案例库、台账与组合演示     |

推荐入口：Demo Center → Featured scenario → Open software review。此入口只切换页面，保留已有审查会话，不创建记录、不自动执行模型。要明确开始新的请求，使用工作台的 Open software review；两者均保留后续发现计划与显式确认创建。

知识 Skill 的中英文展示名明确标为查询，说明制度/合成台账范围与不执行的业务动作；底层 ID、注册名称、描述、版本及原始引用不变。中文展示别名与原始名称都可搜索，未知元数据或版本保留原文。

目录中的 Implementation bound / 实现已绑定仅表示代码实现有绑定，不代表运行健康。治理 Package manifest verified / 运行包清单已验证只表示包清单校验；执行结果和审计回执在结果区独立展示。旧版的 Tool not probed 文案不再与清单状态拼接。案例库保留全部记录，采用可键盘滚动的限高列表和固定表头，不删除历史来美化演示。

## Alternate English Narrative

### Bilingual Product Glossary

Use these meanings consistently in UI dictionaries, reports, demo narration and API documentation. Machine codes remain unchanged.

| English             | Chinese          | Meaning / guardrail                                                                  |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| Intent              | 业务意图         | The user's requested outcome, not permission to execute a write                      |
| Capability          | 企业能力         | The reusable business capability, independent of its consumer                        |
| Skill               | 技能             | A governed capability contract with inputs, outputs, version and policy requirements |
| Plugin              | 插件             | An approved implementation adapter; not an autonomous decision maker                 |
| Workflow            | 工作流           | A defined sequence/dependency plan using capabilities                                |
| Consumer            | 消费者／调用入口 | A Copilot, app, CLI or service using the governed interface                          |
| Review              | 审查             | A business review of an object and its evidence, not a deployment                    |
| Finding             | 发现项           | A supported observation linked to a control and evidence                             |
| Control Check       | 控制检查         | An automated check; passing it does not imply human approval                         |
| Evidence            | 证据             | Traceable source material; translated presentation is not a replacement original     |
| Source              | 来源             | The identified document/system supplying evidence, with its version                  |
| Human Decision      | 人工决定         | Explicit reviewer action with actor, time and reason                                 |
| Review Approved     | 审查批准         | The review decision only; does not mean software is installed or access is granted   |
| Request Information | 要求补充材料     | Preserve the current review and request a linked follow-up, not edit history         |
| Evaluation          | 评价             | Outcome validation against stated criteria; distinguish it from source review        |
| Execution           | 执行             | Actual invocation/effect status, not just a selected or planned Skill                |
| Audit Record        | 审计记录         | Operation accountability metadata, separate from full report/history                 |
| Report              | 报告             | The review's human-readable/exportable evidence, findings and decisions              |
| Synthetic Data      | 模拟数据         | Fictional demo input, not live enterprise or vendor evidence                         |
| Shared DEV Identity | DEV 共享身份     | Explicit demonstration limitation, not independent requester/reviewer roles          |
| In-memory           | 内存保存         | Ephemeral process state, not durable cloud persistence                               |
| Version             | 版本             | Identifies the contract/evidence/rule used, not a quality certification              |

### Opening

"Employees think in outcomes, but enterprise capabilities are scattered across systems and agents. ESP connects an employee's intent to a governed capability, with evidence, evaluation and a visible human decision. This demonstration uses a software security review; the reusable capability model is the point, not another standalone security agent."

### Scene 1 - Discover A Capability

Employee request: **Security review of Docker Desktop**

Use this exact supported request. Extra scope such as `for our development team` is outside the current bounded review grammar and must not be presented as a verified discovery example.

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

Do not substitute the review CLI demonstration for a claim of completed Copilot Studio integration or globally callable review-domain MCP Skills. Repository governance now has a separate Web-to-MCP integration with two read-only tools; that does not make the five review-domain capabilities independently callable. Keep these two implementation boundaries distinct.

### Closing

"ESP makes the capability, its evidence, its governance and its ownership visible across consumers. The prototype demonstrates a controlled review workflow. The next step is independent capability lifecycle management and broader consumer integration, not simply adding more agents."

## Required Scenario Matrix

| ID    | Scenario                          | Required outcome                                                                              | Verification                                                        |
| ----- | --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| SR-01 | Supported English review request  | Correct plan, no write before explicit confirmation                                           | UI + API; verify record count unchanged after discovery             |
| SR-02 | Complete synthetic material       | All controls pass; status remains awaiting human decision                                     | Deterministic tests + deployed scenario                             |
| SR-03 | Explicit approval                 | Reason/actor/time recorded; report available; no real installation claimed                    | Record, report and audit readback                                   |
| SR-04 | Missing material                  | Missing evidence visible; approval blocked; request-information action recorded               | UI disabled action AND server rejects forced approval               |
| SR-05 | High-risk material                | Failing control and risk visible; approval blocked                                            | Server negative test + review report                                |
| SR-06 | Conflicting evidence              | Both sources visible; no implicit newest-wins decision                                        | Evidence references and conflict outcome                            |
| SR-07 | Linked resubmission               | New review points to old review; old record remains unchanged                                 | Read both records and compare original evidence/history             |
| SR-08 | Duplicate or concurrent start     | One review per owner/submission/input; changed input conflicts                                | Concurrent API test + count/readback                                |
| SR-09 | Stale or repeated decision        | Stale incompatible decision rejected; identical completed action reuses result                | ETag tests and audit distinction                                    |
| SR-10 | Unsupported/negated/mixed request | No silent subset execution, no guessed review                                                 | English and Chinese boundary tests                                  |
| SR-11 | Owner/permission boundary         | Inaccessible review not returned; no unauthorized mutation                                    | Server tests; label shared DEV limitation                           |
| SR-12 | Audit/storage failure             | Mutation does not start without audit; uncertain writes never reported as success             | Fault-injection tests; no blind automatic replay                    |
| SR-13 | Cross-consumer reuse              | Same service/capability versions and compatible results; no duplicate business implementation | Web + CLI now; actual Copilot before claiming target integration    |
| SR-14 | English/Chinese switch            | Correct labels/lang; original evidence and recorded human reasons unchanged; no write replay  | SSR/hydration + browser interaction tests                           |
| SR-15 | Refresh/restart                   | Deployed Blob review/report/audit survive restart                                             | Live cloud verification; memory demo explicitly excluded            |
| SR-16 | Version evolution                 | New runs use new version, old evidence/decisions still resolve original version               | Compatibility and retained-version tests before claiming completion |

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

## 备用中文执行稿：先完整后缺失

此段保留原六分钟备用路线，不是 September 17 推荐主线；不得与上方关联补件故事拼接。默认保留英文 UI，中文讲解；需要中文界面时只切换语言，不重新执行操作。以下脚本不宣称新的 AI Readiness 分数、厂商认证或生产可用性。

### 演示材料与安全边界

对象固定为 **Docker Desktop / SIM-SW-202609-0031**，规则版本 **1.0.0**。材料直接复用应用内固定合成证据，不添加真实员工、许可文件或客户数据。

| 材料选项                             | 内容与证据                                              | 预期结果                             | 台上重点                     |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------ | ---------------------------- |
| `complete` / Complete materials      | SIM-SR-LICENSE、SIM-SR-DATA、SIM-SR-SOURCE，均为 v1.0.0 | 三项检查通过，仍等待人工决定         | 自动检查不等于批准           |
| `missing` / Missing materials        | 缺少 SIM-SR-DATA，其余证据原文不变                      | SIM-CTRL-DATA 为 missing，批准被阻断 | 无证据就不能补写结论         |
| `high-risk` / High-risk materials    | SIM-SR-DATA 明确未批准的数据外发                        | SIM-CTRL-DATA 为 fail                | 模型或操作员不能覆盖控制失败 |
| `conflicting` / Conflicting evidence | SIM-SR-LICENSE 与 SIM-SR-LICENSE-ALT 同时存在           | SIM-CTRL-LICENSE 为 conflict         | 不自动用新材料覆盖旧材料     |

前三分钟主线只用 `complete`，接着展示 `missing`；另外两套留作问答或备用。创建和人工决定由现场操作者明确点击。离线包不预先批准、不生成云端工单，也不伪造服务端审计回执。

在仓库根目录生成新的离线包，输出目录的父目录须已存在，目标目录必须不存在：

```powershell
node scripts/prepare-hackathon-demo.mjs artifacts/hackathon-demo-rehearsal
```

生成内容：四份 JSON、八份中英文 HTML、README 和 SHA-256 manifest。每份 HTML 顶部都标明 **OFFLINE REHEARSAL**；语言与 JSON 链接只指向同目录文件。材料由实际审查规则和报告渲染器生成，所有记录保持 `awaiting_decision`。这些本地 ID 不可当成线上记录 ID，不应导入服务端。

### 上台前操作清单

1. 确认本次演示 URL、release ID、权限和数据版本。区分本地 UI 新版与已部署 dev，不因本地修改假定云端也已更新。
2. 主线选择 **Security Review**；固定请求使用 `Security review of Docker Desktop`。不要临场添加“并自动批准”等混合意图。
3. 确认材料下拉框、历史列表、报告、审计入口可见；浏览器缩放保持 100%，投屏建议 1440×900。
4. 确认 **Skill Catalog → Repository governance** 的运行包配置可用。目录中的“Tool not probed”表示当前界面尚未探测，不是成功证明，也不代表历史验收失败。已标识的 `b0dde1fc` 版本完成过两个实际 API 调用及审计、重启验证，见 [发布记录](README.md#current-azure-dev-release)；仅展示界面不会重新执行工具。
5. 主演示不依赖付费模型：固定安全审查与治理快照是确定性路径。Demo Center 中的知识问答属于模型路径，未经明确费用授权不执行。
6. 离线打开完整与缺失材料两份 HTML，并保留本讲稿。使用备用材料必须当场说明“现在切到离线预演材料”。
7. 操作员自己填写决定理由，并在查看证据后决定是否提交；脚本中的示例理由不是代签授权。
8. dev 使用共享测试身份时当场披露：不能据此证明申请人与审查人的职责分离。不要删除既有演示记录来制造整洁画面。

### 00:00–00:40：问题与定位

**画面：工作台。**

“今天我们展示的是 Enterprise Skill Platform，简称 ESP。员工表达的是一个业务目标，但企业能力通常分散在不同系统和 Agent 里。我们希望把能力本身变成可发现、可治理、可复用、可追责的接口，而不是再增加一个独立聊天机器人。”

“接下来用 Docker Desktop 引入审查走一遍闭环。所有材料都是合成数据，不代表真实厂商授权，也不会安装软件或改变生产权限。”

### 00:40–01:25：从意图到明确执行

**操作：Security Review → 输入固定请求 → Discover review capabilities；选 `complete`。暂不点击创建。**

“平台先识别支持的审查范围，给出受理、证据提取、控制检查、风险分析和报告生成的计划。这里的发现只是计划，还没有创建审查记录。”

“当前这五项是安全审查域内的固定能力定义，不是五个全局独立技能。现在我明确点击创建，才进入实际执行。”

**操作：点击 Confirm synthetic review。**

### 01:25–02:35：证据先于结论

**画面：完整材料审查详情，依次指向三项控制与原始证据。**

“我们核对的是三个具体条件：商业许可、数据处理范围、安装与镜像来源。每项发现都能回到证据编号、文档版本和原文。英文展示用于理解，原始证据不会被译文替换。”

“现在三项检查通过，但状态仍是等待人工决定。系统没有把检查通过伪装成业务批准，这正是治理边界。”

### 02:35–03:20：由人承担决定

**操作：人工核对后填写理由，操作者自行决定是否点击 Approve review；打开报告。**

可供操作者修改的合成理由：“已核对本次合成材料的许可、数据范围与来源证据；仅同意演示审查范围，不代表真实安装或上线授权。”

“这一步留下决定人、时间、理由以及对应版本。我们演示的是审查决定，不是自动安装或授予访问。当前 dev 是共享测试身份，独立审批人和职责分离还不能在这里得到证明。”

“报告把范围、发现、证据和人工决定放在一起，方便后续复核，而不是只保存一句结论。”

### 03:20–04:15：失败分支同样可解释

**操作：选择 `missing`，显式创建另一条审查，展示缺失控制和禁用的批准按钮。不要反复点击。**

“同样的请求，如果少了数据处理范围材料，系统就必须停下来。这里明确显示缺什么，不能靠生成一段合理的话把缺口填上。”

“可以要求补充材料，但不能改掉旧证据让原记录变绿。补件会产生关联的新审查，旧记录保留。时间有限时，我们只展示阻断，不继续创建补件记录。”

### 04:15–05:20：复用接口与仓库治理

**操作：Skill Catalog → Repository governance；两个工具最多各运行一次，展示结果和审计链接。**

“目录中现在有七个业务技能和两个独立的仓库治理技能。这里演示的是另一条真实调用链：Web 通过受控接口调用打包的 MCP 工具，读取治理摘要或验证计划。”

“调用需要 governance.read，运行包绑定 manifest 哈希，并先写审计再调用工具。返回结果带来源提交、采集时间和输入摘要。它是打包时的快照，不是实时扫描。验证计划只返回命令，不会替我们运行命令。”

“安全审查与仓库治理是不同领域，但都要回答同样的问题：谁调用了什么、用了哪一版证据、结果如何追溯。”

### 05:20–06:00：收尾与下一步

“ESP 的重点不是让 Agent 获得更多自由，而是让企业能力的输入、边界、证据和责任变得清楚。”

“今天已经演示了受控审查、缺失材料阻断、人工决定、报告与审计，以及独立的仓库治理 MCP 调用。下一步是把更多领域能力纳入统一生命周期管理，补齐真正的多消费者集成和独立身份治理。”

“我们希望复用的是经过治理的能力，而不是复制更多无法追责的流程。”

### 3 分钟压缩版

| 时间      | 画面与话术                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | 工作台：“从业务意图连接可治理、可复用的企业能力；全部是合成演示材料。”                               |
| 0:25–1:20 | 完整材料：“先发现计划，再明确创建。证据有编号、有版本，检查通过后仍需人工决定。”不为赶时间自动批准。 |
| 1:20–2:00 | 缺失材料：“同一能力在证据不足时阻断批准，旧记录不能被改成通过。”                                     |
| 2:00–2:35 | 仓库治理运行一个工具：“MCP 只读调用、包哈希、来源摘要和审计；快照不是实时扫描。”                     |
| 2:35–3:00 | 收尾：“复用受治理能力，而不是复制 Agent。共享身份、全局能力注册和更多消费者仍是后续工作。”           |

### 故障与问答备用话术

- **超时或错误**：“这次没有取得可验证结果，我不会把它算成功，也不会盲目重放。先保留请求或审计 ID，现在切到明确标注的离线预演材料说明结构。”
- **没有配置治理包**：“该环境尚未配置可信运行包，这个状态不会被界面包装成工具成功。”
- **是否真实判断 Docker 安全**：“不是。这是固定合成材料与模拟控制，展示治理流程，不是对厂商产品的安全认证。”
- **为什么不是自动批准**：“发现能力、执行检查和业务授权是不同动作。证据不足或权限不足时，生成模型不能替代授权。”
- **是否已接入所有 Copilot**：“没有。当前仓库治理有 Web-to-MCP，审查已有同 HTTP 服务的 CLI 读取路径；不能据此声称完成所有 Copilot 或五个独立审查 MCP 技能。”
- **演示是否产生数据**：“离线包不写服务器；现场点击创建或决定会写合成审查和审计，读取也可能产生只读审计。不会安装软件、修改网络或进行真实业务支付。”
- **是否 AI Readiness 已满分**：“本轮没有重新运行评分。展示的是可核验实现和证据，不把实现数量换算成未经测量的分数。”
