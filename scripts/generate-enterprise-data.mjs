import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skills = { hr: "search-company-policy", finance: "search-expense-policy", procurement: "search-procurement-guide", security: "search-security-guidance", software: "search-software-catalog" };
const domains = { hr: "HR", finance: "FIN", procurement: "PUR", security: "SEC", software: "IT" };
const owners = { hr: "人力资源部", finance: "财务共享中心", procurement: "采购与供应链部", security: "信息安全部", software: "IT 服务中心" };
const policyDetails = {
  "dev-hr-leave": "适用范围：本样本中的在职正式员工；这里的天数为虚构企业福利口径，不用于判断法定权益。申请须登记员工号、日期、半天粒度和交接确认；经理不在岗时由登记的代理审批人处理。待审批额度计入占用，驳回或撤回后才释放；已批准的起止日期变更须重新审批。人事保留额度调整依据，系统中的当前使用人不能被自动认定为任一合成员工。",
  "dev-hr-attendance": "处理材料：异常日期、实际上下班时间、项目工时或会议记录的脱敏摘要，以及补签原因。重复异常与超过提交时限分开核查；审批通过不代表已修改薪酬结果。主管、人事和本人分别核实事实、制度适用与最终记录，有争议的记录保持待核实，不先行认定违规。",
  "dev-expense-claims": "单据流程：申请人提交，业务审批人核实用途和预算，费用会计核对票据及重复性，付款经办依据获批金额和批次安排。申请金额、暂核金额、批准金额与已付金额不得混为一项。电子票据编号、支付凭证号和原业务申请号都需保留；红冲、退款和重复票据必须关联原记录。员工自购软件须核对集中采购和许可申请，避免同一席位双重支付。",
  "dev-travel-approval": "操作口径：住宿按实际入住晚数和所在地城市核算，餐饮按完整出差日并逐餐扣减。差旅申请应保存项目、员工常驻地点、目的地和行程，缺失目的地不能默认套最高城市限额。行程延长、目的变更或客户取消需要更新申请；已退回款项不得继续申报已发生费用。未获事前批准的超标不因提交说明而自动获得补批。",
  "dev-procurement-request": "金额口径：同一需求的设备、附件、税费、交付和服务费用合并考虑；年度续约与新购分别登记但不得通过拆单规避授权。比价应比较相同规格、税口径、交期和保修，不只看最低报价。预算负责人确认可用预算不等于采购负责人已签约；报价有效期已过或技术配置变更时，重新询价后再下单。",
  "dev-vendor-onboarding": "控制要求：已准入、待安全评估、过期和暂停供应商分开管理。涉及企业数据的服务应说明处理地点、分包商、保留期和删除证据；所有待评估内容齐备前禁止传输真实客户数据。收款主体与合同主体不一致时停止付款核验；本数据包只保留合成凭证引用，不存真实银行账号或证照。",
  "dev-security-phishing": "报告内容限发生时间、渠道、是否点击或输入过凭据、受影响的受管设备编号与安全事件号。不在普通工单粘贴密码、访问令牌或整封可能含敏感信息的邮件；由安全专用渠道保全证据。发现至报告与报告至响应分别计算，不能用一次时间差替代两项指标。演练中的已遏制并不等于真实终端已清理或事件已关闭。",
  "dev-security-sharing": "审批材料包含数据分级、接收组织、接收人、用途、链接期限及撤销责任人。对外设计评审应选择最少必要文件并移除客户原始数据；通过批准渠道且指定接收者后才可发送。链接到期、项目结束或接收者变更应复核授权。内部制度对生产资料的要求，不代表公开 DEV 演示已具备相同的企业权限管理。",
  "dev-software-catalog": "商用软件样本另含 Microsoft 365 E3、Adobe Acrobat Pro、Visual Studio Code 和待评审的 Docker Desktop。真实商品名称只是业务语境；所有采购容量、预算价、批准状态和版本通道均为合成企业配置，不代表厂商报价或对用户设备的安装建议。购买容量减已分配才是可用席位；许可证为零时，已批准预算的申请仍需排队。",
  "dev-software-install": "申请单需与员工、部门、受管设备和软件目录项关联；管理员核对平台兼容性、已有分配和剩余席位。付费申请不得同时在集中采购与个人报销中重复支付。待安全评审的软件不可先行安装；免费工具的扩展、镜像源和数据外发权限仍需独立核查。实际安装完成需要终端执行结果，聊天中的写入预览不是安装证明。",
  "dev-hr-remote": "经理按岗位职责、客户现场安排和交付窗口批准远程工作，不能把团队普遍允许理解为每位员工已获批准。跨部门协作人员按当前汇报关系申请，项目经理确认客户现场安排但不替代人事审批。远程日与休假日不能重叠计入出勤；本包不存真实定位、家庭地址或健康资料。",
  "dev-expense-hospitality": "人数按实际参与人员计，内部员工与客户代表均应纳入同一餐次分母，服务费和税费计入人均标准。发生前的批准须能与本次客户、日期和预算对应，不能复用另一餐次的例外。财务核对事前批准后仍需完成材料复核和付款排程，获批不代表当天到账。",
  "dev-procurement-delivery": "部分到货按批次记录已收、异常、待收数量，未交付部分不得签署已完成验收。报价、订单和发票数量不同应说明原因并核对变更单；少收、超收、损坏及配置不符分别登记。服务类采购以约定交付物、工作量和验收证据核实，不能用会议纪要代替合同要求的交付证明。",
  "dev-security-device": "报失应区分设备遗失、维修和临时借用，记录资产编号、使用人、保修状态、代用设备和交接时间。恢复密钥只能走受限的设备管理渠道，不作为知识资料或工单附件。业务台账中的已解决可能只表示备用机已交付，原设备维修、证据保全和归还仍需单独跟进。",
  "dev-security-access": "审批应由资源负责人确认范围与到期日，申请人不能用口头授权替代批准记录；变更权限、延长时限或更换接收者都应重新核实。复核发现离岗或业务结束后启动撤销并保存完成证据，制度中的撤销流程不代表本 DEV 应用已经实际执行了撤权。",
  "dev-software-service": "事件优先级综合影响和紧迫性；业务台账中的 P1/P2/P3 是合成服务台字段，ESP 当前实际执行的只是 individual/team/organization 影响审批，不提供自动分派或 SLA 计时。工单描述需包含发生时间、设备、受影响功能、人数、复现条件、已做排查和临时方案；敏感日志使用专门渠道。SIM-SR 为参考台账，ESP- 为当前系统真实保存的 DEV 回执，两者不可互相替代。",
};
export const enterpriseStatusLabels = {
  submitted: "已提交",
  discovery: "需求调研", delivery: "实施交付", acceptance: "验收中", closed: "已关闭",
  approved: "已准入", security_review: "待安全评估", expired: "已到期", retired: "已停用",
  assigned: "使用中", in_stock: "在库待分配", loaned: "临时借用", repair: "维修中",
  manager_review: "待直属经理审批", finance_review: "待财务复核", returned: "已退回", exception_review: "超标例外核查", payment_pending: "待付款排程", paid: "已付款", cancelled: "已撤回",
  budget_review: "等待预算负责人审批", legal_review: "待法务及财务审批", ordered: "已下单待到货", part_received: "部分到货", blocked: "准入或材料阻塞",
  license_wait: "等待可用许可证", fulfilled: "已完成安装", contained: "已采取遏制措施", review: "核查中",
  in_progress: "处理中", waiting_approval: "待影响审批", vendor_wait: "等待供应商", resolved: "已解决",
};

export function buildEnterprisePack(data, baseDocuments) {
  const version = "2026.09-sim-v4";
  const records = [];
  const counters = { hr: 100, finance: 100, procurement: 100, security: 100, software: 100 };
  const money = (cents) => `${(cents / 100).toFixed(2)} 元`;
  const person = (id) => { const employee = data.employees.find((entry) => entry.id === id); return employee ? `${employee.name}（${employee.id}，${employee.jobTitle}）` : "未分配"; };
  const department = (id) => { const entry = data.departments.find((candidate) => candidate.id === id); return entry ? `${entry.name} / ${entry.id}` : "未指定"; };
  const project = (id) => { const entry = data.projects.find((candidate) => candidate.id === id); return entry ? `${entry.name} / ${entry.id}` : "非项目费用"; };
  const vendor = (id) => { const entry = data.vendors.find((candidate) => candidate.id === id); return entry ? `${entry.name} / ${entry.id}` : "未指定"; };
  const software = (id) => { const entry = data.software.find((candidate) => candidate.id === id); return entry ? `${entry.name} / ${entry.id}` : "未指定"; };
  const site = (id) => data.sites.find((entry) => entry.id === id)?.name ?? "未指定";
  const status = (value) => enterpriseStatusLabels[value] ?? value;
  const fields = (items) => items.map(([label, value]) => ({ label, value: String(value) }));
  function add(kind, category, entry, title, state, entries, sections, relatedIds, query, action = null) {
    const sourceId = `dev-${entry.id.toLowerCase().replace(/^sim-/, "")}`;
    records.push({ id: entry.id, kind, category, title, status: state, statusLabel: state === "active" ? "有效样本" : kind === "software" && state === "approved" ? "已批准" : status(state), sourceId, documentNumber: `SIM-${domains[category]}-${++counters[category]}`, skillId: skills[category], fields: fields(entries), sections: sections.map(([heading, content]) => ({ heading, content })), relatedIds: [...new Set(relatedIds.filter(Boolean))], query, action });
  }
  for (const entry of data.employees) add("employee", "hr", entry, `${entry.name} / ${entry.jobTitle}`, "active", [
    ["员工编号", entry.id], ["姓名", entry.name], ["部门与成本中心", department(entry.departmentId)], ["办公地点", site(entry.siteId)], ["直属经理", person(entry.managerId)], ["入职日期", entry.joinedAt], ["工作邮箱（不可投递）", entry.email], ["年假额度", `${entry.leave.entitlement} 天`], ["已休", `${entry.leave.taken} 天`], ["待审批占用", `${entry.leave.pending} 天`], ["可用余额", `${entry.leave.available} 天`],
  ], [["余额口径", `年度额度 ${entry.leave.entitlement} - 已休 ${entry.leave.taken} - 待审批占用 ${entry.leave.pending} = 可用 ${entry.leave.available} 天；不含历史结转。${data.asOf} 固定快照，不绑定当前登录用户，不代表真实人事查询。`]], [entry.departmentId, entry.managerId, ...data.assets.filter((asset) => asset.employeeId === entry.id).map((asset) => asset.id)], `员工制度中，${entry.id}${entry.name}的部门、直属经理和年假余额是多少？`);
  for (const entry of data.departments) add("costCenter", "finance", entry, entry.name, "active", [
    ["成本中心", entry.id], ["负责人", person(entry.managerId)], ["季度预算", money(entry.quarterBudgetCents)], ["已发生", money(entry.actualCents)], ["已承诺未发生", money(entry.committedCents)], ["可用预算", money(entry.quarterBudgetCents - entry.actualCents - entry.committedCents)], ["统计期间", "2026 年第三季度"],
  ], [["预算口径", "可用预算 = 季度预算 - 已发生 - 已承诺未发生。此处为期末合成汇总，明细样本不是完整总账；报销审批和采购签约不能直接改写这个快照。"]], [entry.managerId, ...data.projects.filter((item) => item.costCenterId === entry.id).map((item) => item.id)], `费用成本中心 ${entry.id}${entry.name}的预算、已发生、已承诺及可用余额分别是多少？`);
  for (const entry of data.projects) add("project", "finance", entry, entry.name, entry.status, [
    ["项目编号", entry.id], ["客户", entry.customer], ["项目负责人", person(entry.ownerId)], ["成本中心", department(entry.costCenterId)], ["开始日期", entry.startDate], ["目标日期", entry.targetDate], ["项目总预算", money(entry.budgetCents)], ["已发生", money(entry.actualCents)], ["已承诺", money(entry.committedCents)], ["可用预算", money(entry.budgetCents - entry.actualCents - entry.committedCents)],
  ], [["当前里程碑", entry.milestone], ["预算边界", "项目全周期预算不同于季度部门预算，也不等于可直接付款的额度。审批和实际付款必须保留独立证据。"]], [entry.ownerId, entry.costCenterId, ...data.expenses.filter((expense) => expense.projectId === entry.id).map((expense) => expense.id)], `费用项目 ${entry.id}${entry.name}的预算还剩多少，当前里程碑是什么？`);
  for (const entry of data.vendors) add("vendor", "procurement", entry, entry.name, entry.status, [
    ["供应商编号", entry.id], ["服务类别", entry.category], ["准入状态", status(entry.status)], ["有效期至", entry.validUntil ?? "尚未生效"], ["风险等级", entry.risk], ["付款条款", entry.paymentTerms],
  ], [["审查结论与下一步", entry.reviewNote], ["交易边界", "只有准入有效并完成需求审批的供应商才能接收订单。报价、验收、发票与付款为不同环节；此数据没有银行账户或真实注册号码。"]], data.purchases.filter((purchase) => purchase.vendorId === entry.id).map((purchase) => purchase.id), `供应商 ${entry.id}${entry.name}当前能否下单，准入有效期和待补事项是什么？`);
  for (const entry of data.assets) add("asset", "software", entry, `${entry.id} / ${entry.name}`, entry.status, [
    ["资产编号", entry.id], ["型号", entry.name], ["使用人", person(entry.employeeId)], ["地点", site(entry.siteId)], ["系统", entry.os], ["合成序列号", entry.serial], ["采购日期", entry.acquiredAt], ["采购原值", money(entry.costCents)], ["保修到期", entry.warrantyUntil], ["最近盘点", entry.lastInventoryAt],
  ], [["资产备注", entry.note], ["资产状态说明", "该台账为合成快照；没有与 MDM、设备控制或实际采购系统建立实时同步。不会远程锁定、擦除或安装软件。"]], [entry.employeeId, ...data.softwareRequests.filter((request) => request.assetId === entry.id).map((request) => request.id)], `软件服务资产 ${entry.id}的使用人、保修日期和当前状态是什么？`);
  for (const entry of data.software) add("software", "software", entry, entry.name, entry.status, [
    ["软件编号", entry.id], ["版本", entry.version], ["用途", entry.purpose], ["批准状态", entry.status === "approved" ? "已批准" : status(entry.status)], ["支持平台", entry.platforms.join("、")], ["年度每席预算价", money(entry.annualUnitCents)], ["购买容量", entry.seats === null ? "不采用付费席位库存" : `${entry.seats} 席`], ["已分配", `${entry.allocated} 席`], ["可用", entry.available === null ? "不采用付费席位库存" : `${entry.available} 席`], ["续期到期日", entry.renewalDate ?? "不适用或未签约"], ["责任人", person(entry.ownerId)],
  ], [["分发渠道", entry.distribution], ["价格及授权口径", entry.priceBasis], ["库存口径", "购买容量减已分配得到可用席位；待审批申请不等于已经分配。创建 DEV 工单不会自动扣减库存或购买许可证。"]], [entry.ownerId, ...data.softwareRequests.filter((request) => request.softwareId === entry.id).map((request) => request.id)], `批准软件目录中，${entry.name}（${entry.id}）的审批状态、许可余量和续期日期是什么？`);
  for (const entry of data.expenses) add("expense", "finance", entry, `${entry.id} / ${entry.purpose}`, entry.status, [
    ["报销单", entry.id], ["申请人", person(entry.employeeId)], ["成本中心", department(entry.costCenterId)], ["项目", project(entry.projectId)], ["费用日期", entry.incurredAt], ["提交日期", entry.submittedAt], ["申请总额", money(entry.grossCents)], ["暂核或批准金额", money(entry.approvedCents)], ["已支付", money(entry.paidCents)], ["当前状态", status(entry.status)], ["适用制度", entry.policyNumber],
  ], [["费用明细", entry.lines.map((line) => `${line.description}：${line.quantity} × ${money(line.unitCents)} = ${money(line.amountCents)}；凭证 ${line.evidence.join("、") || "缺失"}`).join("\n")], ["处理记录", entry.events.map((event) => `${event.at} ${person(event.actorId)} / ${status(event.state)}：${event.note}`).join("\n")], ["待办与风险", entry.nextAction], ["数据性质", "固定合成业务台账，不是实时财务查询。未付款不得表述为到账，暂核金额不代表已批准付款，回执编号没有真实银行含义。"]], [entry.employeeId, entry.costCenterId, entry.projectId], `报销单 ${entry.id}的费用明细、申请总额、当前状态和下一步是什么？`);
  for (const entry of data.purchases) add("purchase", "procurement", entry, `${entry.id} / ${entry.item}`, entry.status, [
    ["采购申请", entry.id], ["申请人", person(entry.requesterId)], ["需求", entry.item], ["项目", project(entry.projectId)], ["成本中心", department(entry.costCenterId)], ["数量", entry.quantity], ["含税单价", money(entry.unitCents)], ["含税总额", money(entry.totalCents)], ["拟选或签约供应商", vendor(entry.vendorId)], ["需求日期", entry.neededBy], ["订单号", entry.orderId ?? "尚未下单"], ["已收数量", entry.receivedQuantity], ["未收数量", entry.quantity - entry.receivedQuantity],
  ], [["比价记录", entry.quotes.map((quote) => `${vendor(quote.vendorId)}：含税 ${money(quote.totalCents)}，交期 ${quote.leadDays} 个工作日；${quote.note}`).join("\n")], ["当前处理意见", entry.nextAction], ["授权与付款边界", "适用 SIM-PUR-001 授权矩阵。报价不等于订单，部分到货不等于全部验收，采购关闭不等于付款完成；ESP 不发送真实订单。"]], [entry.requesterId, entry.projectId, entry.costCenterId, entry.vendorId], `采购申请 ${entry.id}的金额、报价、审批或交付阻塞是什么？`);
  for (const entry of data.softwareRequests) add("softwareRequest", "software", entry, `${entry.id} / ${software(entry.softwareId)}`, entry.status, [
    ["软件申请", entry.id], ["申请人", person(entry.employeeId)], ["设备", entry.assetId], ["软件", software(entry.softwareId)], ["成本中心", department(entry.costCenterId)], ["申请日期", entry.requestedAt], ["状态", status(entry.status)],
  ], [["下一步", entry.nextAction], ["安装边界", "SIM-IT-002 的安装处理目标从全部审批完成且许可证可用后起算；本页面不会安装软件或分配实际许可证。"]], [entry.employeeId, entry.assetId, entry.softwareId, entry.costCenterId], `软件安装申请 ${entry.id}目前卡在哪一步，何时可以开始安装排期？`);
  for (const entry of data.securityCases) add("securityCase", "security", entry, `${entry.id} / ${entry.category === "phishing" ? "可疑邮件报告" : entry.category === "sharing" ? "外部共享审查" : "软件安全评审"}`, entry.status, [
    ["事件编号", entry.id], ["报告人", person(entry.reporterId)], ["处理人", person(entry.ownerId)], ["优先级", entry.priority], ["发现时间", entry.detectedAt], ["报告时间", entry.reportedAt], ["响应时间", entry.respondedAt], ["发现至报告", `${(Date.parse(entry.reportedAt) - Date.parse(entry.detectedAt)) / 60000} 分钟`], ["报告至响应", `${(Date.parse(entry.respondedAt) - Date.parse(entry.reportedAt)) / 60000} 分钟`],
  ], [["事件摘要", entry.description], ["当前处置", entry.nextAction], ["演练边界", "仅为演练样本，不包含真实邮件、账户凭据或客户资料；不会通知真实安全团队或执行账号操作。"]], [entry.reporterId, entry.ownerId], `信息安全事件 ${entry.id}的报告与响应耗时、当前处置状态是什么？`);
  for (const entry of data.serviceRequests) add("serviceRequest", "software", entry, `${entry.id} / ${entry.title}`, entry.status, [
    ["服务台样本编号", entry.id], ["请求人", person(entry.employeeId)], ["设备", entry.assetId ?? "多系统，不适用单一设备"], ["项目", entry.projectId ? project(entry.projectId) : "日常 IT 服务"], ["业务优先级", entry.priority], ["影响范围", { individual: "个人", team: "团队", organization: "全公司" }[entry.impact]], ["处理队列", entry.queue], ["登记时间", entry.openedAt], ["最近更新", entry.updatedAt],
  ], [["现象、影响与已做排查", entry.description], ["下一步", entry.nextAction], ["回执边界", "SIM-SR 是参考服务台台账，不是 ESP- 开头的执行回执，不能用它查询当前 DEV 工单。按此场景创建时仍需先预览和确认，团队或组织影响另需审批。"]], [entry.employeeId, entry.assetId, entry.projectId], `软件服务台样本 ${entry.id}的现象、影响范围与处理进度是什么？`, { skillId: "create-it-ticket", query: entry.description, parameters: { description: entry.description, impact: entry.impact, ...(entry.assetId ? { device: entry.assetId } : {}) } });

  const snapshots = new Map([
    ["dev-hr-roster", `【模拟数据】截至${data.asOf}，员工全部虚构，不绑定当前登录用户。${data.employees.slice(0, 3).map((entry) => `${entry.id}${entry.name}，${department(entry.departmentId)}；年度年假额度${entry.leave.entitlement}天、已休${entry.leave.taken}天、待审批占用${entry.leave.pending}天、可用余额${entry.leave.available}天。`).join("")}余额为额度减已休减待审批占用，不含上年结转，不能据此推断当前登录人的余额。`],
    ["dev-expense-snapshot", `【模拟数据】截至${data.asOf}的固定快照。${data.expenses.slice(0, 2).map((entry) => `报销单${entry.id}属于${entry.employeeId}，成本中心${entry.costCenterId}，关联项目${entry.projectId}，总额${entry.grossCents / 100}元；${entry.lines.map((line) => `${line.description}，合计${line.amountCents / 100}元`).join("；")}。状态${status(entry.status)}，已付款${entry.paidCents / 100}元；${entry.nextAction}。`).join("")}这不是实时财务查询，不会执行付款。`],
    ["dev-procurement-snapshot", `【模拟数据】截至${data.asOf}，项目${data.projects[0].id}「${data.projects[0].name}」由${department(data.projects[0].costCenterId)}负责，项目总预算${data.projects[0].budgetCents / 100}元（不是采购单金额）。${data.purchases.slice(0, 2).map((entry) => `采购申请${entry.id}，${entry.item}，数量${entry.quantity}，单价${entry.unitCents / 100}元，总额${entry.totalCents / 100}元；${entry.quotes.length}份报价，供应商${vendor(entry.vendorId)}。${entry.nextAction}。`).join("")}所有记录为固定样本，不代表本平台已经下单。`],
    ["dev-software-licenses", `【模拟数据】截至${data.asOf}，${data.software.slice(0, 2).map((entry) => `${entry.name}${entry.version}购买容量${entry.seats}席，已分配${entry.allocated}席，可用${entry.available}席，年度模拟单价${entry.annualUnitCents / 100}元/席，到期日${entry.renewalDate}。`).join("")}应至少提前30个自然日发起续费申请；连续30个自然日未使用的许可证先通知使用人及经理，确认不再需要后才回收。星舟协作没有付费席位库存限制。静态库存不随 DEV 工单变化；其他商用产品另见逐项软件记录，价格均为合成合同预算而非厂商报价。`],
  ]);
  const documents = baseDocuments.map((document) => ({ ...document, version, ...(snapshots.has(document.id) ? { content: snapshots.get(document.id), effectiveDate: data.asOf, section: `截至 ${data.asOf} 的业务台账摘要` } : { content: `${document.content}\n\n${policyDetails[document.id] ?? ""}`.trim() }) }));
  documents.push({
    id: "dev-software-vpn-support", skillId: skills.software, corpus: "esp-dev-samples-v1", permission: "knowledge.read", version,
    organization: data.organization.name, documentNumber: "SIM-IT-005", owner: owners.software, effectiveDate: "2026-09-01", dataKind: "policy",
    title: "企业 VPN 连接故障受理与升级规范（模拟）", section: "受理、受管终端核对、升级与恢复确认",
    content: "【模拟数据】本规范是虚构组织澄川数科的演示制度，适用于已授权员工在受管设备上使用企业批准 VPN 客户端时的连接故障，不是厂商故障修复手册或实际服务承诺。不得仅凭错误码认定根因；认证通过不等于资源访问已授权。\n\n受理要素：服务台关联已有工单，记录发生时间和时区、设备编号、操作系统及客户端版本、受影响资源、影响人数与业务紧迫性、错误提示、复现网络、已做排查和临时方案。缺失项标为待补充，不根据历史台账猜测。普通工单只保留脱敏错误摘要；密码、令牌、私钥、验证码和完整敏感日志不得收集到工单，由受限支持渠道处理必要的脱敏诊断资料。\n\n设备与软件核对：由终端管理人员在受限管理系统核对设备是否受管、当前合规状态、系统支持范围、批准的 VPN 客户端版本和配置来源、系统时间及证书有效状态，并由资源负责人核对访问授权范围。已完成的用户排查记录为报告事实，不代表检查结果已被确认。不得关闭防火墙、终端防护、多因素认证或证书校验来绕过故障，也不得要求用户导出凭据或自行修改安全策略。\n\n后续处理与必要审批：服务台完成受理后，客户端版本、配置或合规异常转终端管理组核查；在不同网络均可复现且终端检查未发现异常时，携带脱敏复现信息升级网络支持组，核对 VPN 服务健康与受影响资源连通性，不预先认定为网络故障。涉及新增或扩大资源访问权限须走资源负责人授权审批；涉及客户端重装、网络配置或安全策略变更须按相应变更及软件审批流程获批后由授权管理员执行。普通故障受理不等于需要购买许可证，不能直接套用软件安装预算审批。不得重复创建同一事项的工单来代替升级处理。\n\n恢复确认：实施人员记录获批操作、执行时间和结果，由申请人在原受影响资源上复测并确认业务访问恢复；服务台保存确认记录后才能标记解决。仅客户端显示连接成功、工单被转派或聊天给出建议，都不能证明业务已恢复。仍未恢复时保留未解决状态并继续原工单跟进。ESP DEV 只读取工单与规范，不执行终端、网络或权限操作，也不自动分派、修复或关闭工单。",
    searchTerms: "VPN 连接故障 IT 服务台 工单受理 设备兼容性 终端合规 客户端 核对要求 后续处理 升级 网络支持 恢复确认 审批规范",
  });
  documents.push(...records.map((record) => ({ id: record.sourceId, skillId: record.skillId, corpus: "esp-dev-samples-v1", permission: "knowledge.read", version, organization: data.organization.name, documentNumber: record.documentNumber, owner: owners[record.category], effectiveDate: data.asOf, dataKind: "snapshot", title: `${record.title}（模拟）`, section: `${data.asOf} / ${record.id}`, content: `【模拟数据】${data.organization.name}，截至 ${data.asOf} 的合成业务快照，不是当前用户的真实资料。\n${record.fields.map((field) => `${field.label}：${field.value}`).join("\n")}\n当前状态：${record.status === "active" ? "有效样本" : record.statusLabel}\n${record.sections.map((section) => `${section.heading}：${section.content}`).join("\n")}`, searchTerms: `${record.id} ${record.title} ${record.relatedIds.join(" ")} ${record.query}` })));
  const connectorExamples = [
    ["sim-hr-employee-handoff", "SIM-EMP-1002"], ["sim-fin-expense-review", "SIM-EXP-202609-0018"], ["sim-pur-contract-review", "SIM-PR-202609-0062"],
    ["sim-sec-incident-review", "SIM-SEC-202609-0019"], ["sim-it-license-request", "SIM-SW-202609-0029"],
  ].map(([id, recordId]) => {
    const record = records.find((entry) => entry.id === recordId);
    if (!record) throw new Error(`Missing fixed connector record ${recordId}`);
    const document = documents.find((entry) => entry.id === record.sourceId);
    return { id, title: document.title, skillId: document.skillId, documentNumber: `${document.documentNumber}-BLOB`, owner: document.owner, effectiveDate: data.asOf, dataKind: "snapshot", filename: `${id}.md`, simulated: true, content: document.content };
  });
  return { version, asOf: data.asOf, simulated: true, records, documents, connectorExamples };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(await readFile(new URL("../src/data/enterprise-data.json", import.meta.url), "utf8"));
  const policies = JSON.parse(await readFile(new URL("../src/data/knowledge-samples.json", import.meta.url), "utf8"));
  const pack = buildEnterprisePack(data, policies);
  const content = `${JSON.stringify(pack, null, 2)}\n`;
  const target = new URL("../src/data/enterprise-pack.json", import.meta.url);
  if (process.argv.includes("--check")) {
    if (await readFile(target, "utf8") !== content) throw new Error("Enterprise pack is stale; run npm run data:build");
  } else await writeFile(target, content);
  console.log(`Enterprise pack ${process.argv.includes("--check") ? "verified" : "generated"}: ${pack.records.length} linked views, ${pack.documents.length} knowledge documents`);
}