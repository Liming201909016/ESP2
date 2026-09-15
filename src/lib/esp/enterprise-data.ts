import { z } from "zod";
import rawData from "../../data/enterprise-data.json";

const idSchema = z.string().regex(/^(SIM-[A-Z0-9-]+|CC-[A-Z]{2}-\d{3})$/);
const textSchema = z.string().trim().min(1);
const moneySchema = z.number().int().min(0).max(1_000_000_000_000);
const dateSchema = z.iso.date();
const budgetShape = { budgetCents: moneySchema, actualCents: moneySchema, committedCents: moneySchema };
const employeeLink = { employeeId: idSchema };
const projectLink = { projectId: idSchema.nullable(), costCenterId: idSchema };

export const enterpriseDataSchema = z.object({
  version: z.literal("2026.09-enterprise-v1"), asOf: dateSchema, simulated: z.literal(true),
  organization: z.object({ id: idSchema, name: z.literal("澄川数科（虚构组织）"), industry: textSchema, currency: z.literal("CNY"), scope: textSchema }).strict(),
  sites: z.array(z.object({ id: idSchema, name: textSchema, city: textSchema, timezone: z.literal("Asia/Shanghai") }).strict()).min(1),
  departments: z.array(z.object({ id: idSchema, name: textSchema, managerId: idSchema, quarterBudgetCents: moneySchema, actualCents: moneySchema, committedCents: moneySchema }).strict()).min(1),
  employees: z.array(z.object({
    id: idSchema, name: textSchema, departmentId: idSchema, siteId: idSchema, jobTitle: textSchema, managerId: idSchema.nullable(), joinedAt: dateSchema,
    email: z.email().regex(/@chengchuan\.example$/),
    leave: z.object({ entitlement: z.number().nonnegative().multipleOf(0.5), taken: z.number().nonnegative().multipleOf(0.5), pending: z.number().nonnegative().multipleOf(0.5), available: z.number().nonnegative().multipleOf(0.5) }).strict(),
  }).strict()).min(1),
  projects: z.array(z.object({ id: idSchema, name: textSchema, customer: textSchema, ownerId: idSchema, costCenterId: idSchema, status: z.enum(["discovery", "delivery", "acceptance", "closed"]), startDate: dateSchema, targetDate: dateSchema, ...budgetShape, milestone: textSchema }).strict()),
  vendors: z.array(z.object({ id: idSchema, name: textSchema, category: textSchema, status: z.enum(["approved", "security_review", "expired"]), validUntil: dateSchema.nullable(), paymentTerms: textSchema, risk: z.enum(["low", "medium", "high"]), reviewNote: textSchema }).strict()),
  assets: z.array(z.object({ id: idSchema, name: textSchema, kind: z.enum(["laptop", "conference", "monitor", "network"]), employeeId: idSchema.nullable(), siteId: idSchema, serial: z.string().startsWith("SIM-SN-"), os: textSchema, status: z.enum(["assigned", "in_stock", "loaned", "repair", "retired"]), acquiredAt: dateSchema, warrantyUntil: dateSchema, costCents: moneySchema, lastInventoryAt: dateSchema, note: textSchema }).strict()),
  software: z.array(z.object({ id: idSchema, name: textSchema, version: textSchema, purpose: textSchema, status: z.enum(["approved", "security_review", "retired"]), platforms: z.array(textSchema).min(1), annualUnitCents: moneySchema, seats: z.number().int().nonnegative().nullable(), allocated: z.number().int().nonnegative(), available: z.number().int().nonnegative().nullable(), renewalDate: dateSchema.nullable(), ownerId: idSchema, distribution: textSchema, priceBasis: textSchema }).strict()),
  expenses: z.array(z.object({
    id: idSchema, ...employeeLink, ...projectLink, purpose: textSchema, incurredAt: dateSchema, submittedAt: dateSchema,
    status: z.enum(["manager_review", "finance_review", "returned", "exception_review", "payment_pending", "paid", "cancelled"]),
    grossCents: moneySchema, approvedCents: moneySchema, paidCents: moneySchema, nextAction: textSchema, policyNumber: idSchema,
    lines: z.array(z.object({ category: z.enum(["lodging", "rail", "meal", "hospitality", "software", "courier", "taxi"]), description: textSchema, quantity: z.number().int().positive(), unitCents: moneySchema, amountCents: moneySchema, evidence: z.array(idSchema) }).strict()).min(1),
    events: z.array(z.object({ at: z.iso.datetime(), actorId: idSchema, state: textSchema, note: textSchema }).strict()).min(1),
  }).strict()),
  purchases: z.array(z.object({ id: idSchema, requesterId: idSchema, ...projectLink, item: textSchema, quantity: z.number().int().positive(), unitCents: moneySchema, totalCents: moneySchema, status: z.enum(["budget_review", "legal_review", "ordered", "part_received", "blocked", "closed"]), vendorId: idSchema, neededBy: dateSchema, receivedQuantity: z.number().int().nonnegative(), orderId: idSchema.nullable(), nextAction: textSchema, quotes: z.array(z.object({ vendorId: idSchema, totalCents: moneySchema, leadDays: z.number().int().positive(), note: textSchema }).strict()).min(1) }).strict()),
  softwareRequests: z.array(z.object({ id: idSchema, ...employeeLink, assetId: idSchema, softwareId: idSchema, costCenterId: idSchema, status: z.enum(["budget_review", "license_wait", "security_review", "fulfilled"]), requestedAt: dateSchema, nextAction: textSchema }).strict()),
  securityCases: z.array(z.object({ id: idSchema, reporterId: idSchema, ownerId: idSchema, category: z.enum(["phishing", "sharing", "software"]), priority: z.enum(["P1", "P2", "P3"]), status: z.enum(["contained", "review", "closed"]), detectedAt: z.iso.datetime(), reportedAt: z.iso.datetime(), respondedAt: z.iso.datetime(), description: textSchema, nextAction: textSchema }).strict()),
  serviceRequests: z.array(z.object({ id: idSchema, title: textSchema, ...employeeLink, assetId: idSchema.nullable(), projectId: idSchema.nullable(), impact: z.enum(["individual", "team", "organization"]), priority: z.enum(["P1", "P2", "P3"]), status: z.enum(["in_progress", "waiting_approval", "vendor_wait", "license_wait", "resolved"]), queue: textSchema, openedAt: z.iso.datetime(), updatedAt: z.iso.datetime(), description: textSchema, nextAction: textSchema }).strict()),
}).strict().superRefine((data, context) => {
  const check = (condition: boolean, message: string) => { if (!condition) context.addIssue({ code: "custom", message }); };
  const collections = [data.sites, data.departments, data.employees, data.projects, data.vendors, data.assets, data.software, data.expenses, data.purchases, data.softwareRequests, data.securityCases, data.serviceRequests];
  const ids = collections.flatMap((records) => records.map((record) => record.id));
  check(new Set(ids).size === ids.length, "Record IDs must be unique across the data pack");
  const employees = new Map(data.employees.map((employee) => [employee.id, employee]));
  const projects = new Map(data.projects.map((project) => [project.id, project]));
  const departments = new Set(data.departments.map((department) => department.id));
  const sites = new Set(data.sites.map((site) => site.id));
  const assets = new Map(data.assets.map((asset) => [asset.id, asset]));
  const software = new Map(data.software.map((entry) => [entry.id, entry]));
  const vendors = new Map(data.vendors.map((vendor) => [vendor.id, vendor]));
  const pastDate = (date: string) => date.slice(0, 10) <= data.asOf;
  const projectCost = (record: { id: string; projectId: string | null; costCenterId: string }) => {
    check(departments.has(record.costCenterId), `${record.id}: missing cost center`);
    if (record.projectId) check(projects.get(record.projectId)?.costCenterId === record.costCenterId, `${record.id}: project/cost center mismatch`);
  };
  for (const department of data.departments) {
    check(employees.get(department.managerId)?.departmentId === department.id, `${department.id}: manager must belong to department`);
    check(department.actualCents + department.committedCents <= department.quarterBudgetCents, `${department.id}: budget does not reconcile`);
  }
  for (const employee of data.employees) {
    check(departments.has(employee.departmentId) && sites.has(employee.siteId), `${employee.id}: unknown department/site`);
    check(employee.managerId === null || employees.has(employee.managerId) && employee.managerId !== employee.id, `${employee.id}: invalid manager`);
    check(pastDate(employee.joinedAt), `${employee.id}: future join date`);
    check(employee.leave.entitlement - employee.leave.taken - employee.leave.pending === employee.leave.available, `${employee.id}: leave balance mismatch`);
    const joined = new Date(`${employee.joinedAt}T00:00:00Z`);
    const snapshot = new Date(`${data.asOf}T00:00:00Z`);
    let completedYears = snapshot.getUTCFullYear() - joined.getUTCFullYear();
    const anniversary = new Date(joined); anniversary.setUTCFullYear(snapshot.getUTCFullYear());
    if (anniversary > snapshot) completedYears -= 1;
    if (completedYears >= 1) check(employee.leave.entitlement === (completedYears >= 10 ? 20 : completedYears >= 5 ? 15 : 10), `${employee.id}: leave entitlement does not match tenure policy`);
  }
  for (const project of data.projects) {
    check(employees.has(project.ownerId) && departments.has(project.costCenterId), `${project.id}: invalid project owner/cost center`);
    check(project.startDate <= project.targetDate && pastDate(project.startDate), `${project.id}: invalid project dates`);
    check(project.actualCents + project.committedCents <= project.budgetCents, `${project.id}: budget does not reconcile`);
  }
  for (const vendor of data.vendors) check(vendor.status !== "approved" || vendor.validUntil !== null && vendor.validUntil >= data.asOf, `${vendor.id}: approved vendor expired`);
  for (const asset of data.assets) {
    check(sites.has(asset.siteId) && (asset.employeeId === null || employees.has(asset.employeeId)), `${asset.id}: invalid asset links`);
    check(asset.acquiredAt <= asset.lastInventoryAt && pastDate(asset.lastInventoryAt) && asset.acquiredAt <= asset.warrantyUntil, `${asset.id}: invalid asset dates`);
    check(asset.status !== "in_stock" || asset.employeeId === null, `${asset.id}: stock asset has custodian`);
  }
  for (const entry of data.software) {
    check(employees.has(entry.ownerId), `${entry.id}: missing software owner`);
    check(entry.seats === null ? entry.available === null && entry.allocated === 0 : entry.seats - entry.allocated === entry.available, `${entry.id}: license inventory mismatch`);
  }
  for (const expense of data.expenses) {
    projectCost(expense); check(employees.has(expense.employeeId), `${expense.id}: unknown employee`);
    check(expense.incurredAt <= expense.submittedAt && pastDate(expense.submittedAt), `${expense.id}: invalid expense dates`);
    check(expense.lines.every((line) => line.quantity * line.unitCents === line.amountCents), `${expense.id}: line amount mismatch`);
    check(expense.lines.reduce((total, line) => total + line.amountCents, 0) === expense.grossCents, `${expense.id}: gross amount mismatch`);
    check(expense.paidCents <= expense.approvedCents && expense.approvedCents <= expense.grossCents, `${expense.id}: payment exceeds amount`);
    check(expense.status === "paid" ? expense.paidCents === expense.approvedCents && expense.paidCents > 0 : expense.paidCents === 0, `${expense.id}: payment/status mismatch`);
    check(expense.events.every((event, index) => employees.has(event.actorId) && pastDate(event.at) && event.at.slice(0, 10) >= expense.submittedAt && (index === 0 || event.at >= expense.events[index - 1].at)), `${expense.id}: invalid audit sequence`);
    check(expense.events.at(-1)?.state === expense.status, `${expense.id}: latest event/status mismatch`);
  }
  for (const purchase of data.purchases) {
    projectCost(purchase); check(employees.has(purchase.requesterId), `${purchase.id}: unknown requester`);
    check(purchase.quantity * purchase.unitCents === purchase.totalCents, `${purchase.id}: purchase amount mismatch`);
    check(purchase.quotes.every((quote) => vendors.has(quote.vendorId)) && purchase.quotes.some((quote) => quote.vendorId === purchase.vendorId && quote.totalCents === purchase.totalCents), `${purchase.id}: invalid quote/vendor`);
    check(new Set(purchase.quotes.map((quote) => quote.vendorId)).size === purchase.quotes.length, `${purchase.id}: duplicate vendor quote`);
    check(purchase.receivedQuantity <= purchase.quantity, `${purchase.id}: over-received quantity`);
    if (purchase.orderId) {
      check(vendors.get(purchase.vendorId)?.status === "approved", `${purchase.id}: unapproved vendor order`);
      check(purchase.totalCents <= 500_000 || purchase.quotes.length >= 3, `${purchase.id}: missing competitive quotes`);
    } else check(purchase.receivedQuantity === 0, `${purchase.id}: received without order`);
    check(["ordered", "part_received", "closed"].includes(purchase.status) === Boolean(purchase.orderId), `${purchase.id}: order/status mismatch`);
  }
  for (const request of data.softwareRequests) {
    check(employees.get(request.employeeId)?.departmentId === request.costCenterId && assets.get(request.assetId)?.employeeId === request.employeeId && software.has(request.softwareId), `${request.id}: invalid software request links`);
    check(pastDate(request.requestedAt), `${request.id}: future software request`);
    if (request.status === "fulfilled") check(software.get(request.softwareId)?.status === "approved", `${request.id}: unapproved installation`);
  }
  for (const incident of data.securityCases) {
    check(employees.has(incident.reporterId) && employees.has(incident.ownerId), `${incident.id}: unknown incident participants`);
    check(incident.detectedAt <= incident.reportedAt && incident.reportedAt <= incident.respondedAt && pastDate(incident.respondedAt), `${incident.id}: invalid incident timeline`);
  }
  for (const request of data.serviceRequests) {
    check(employees.has(request.employeeId) && (request.assetId === null || assets.has(request.assetId)) && (request.projectId === null || projects.has(request.projectId)), `${request.id}: invalid service references`);
    check(request.openedAt <= request.updatedAt && pastDate(request.updatedAt), `${request.id}: invalid service timeline`);
  }
});

export type EnterpriseData = z.infer<typeof enterpriseDataSchema>;
export const enterpriseData: EnterpriseData = enterpriseDataSchema.parse(rawData);
export function yuan(cents: number) { return (cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }