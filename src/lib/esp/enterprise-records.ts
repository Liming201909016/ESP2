import { z } from "zod";
import pack from "../../data/enterprise-pack.json";
import { ticketDetailsSchema } from "./contracts";

export const enterpriseRecordTypes = {
  employee: "员工档案", costCenter: "成本中心", project: "项目预算", vendor: "供应商", asset: "设备资产", software: "软件许可",
  expense: "报销单", purchase: "采购申请", softwareRequest: "软件申请", securityCase: "安全演练", serviceRequest: "服务台样本",
} as const;

export const enterpriseRecordSchema = z.object({
  id: z.string(), kind: z.enum(Object.keys(enterpriseRecordTypes) as [keyof typeof enterpriseRecordTypes, ...(keyof typeof enterpriseRecordTypes)[]]),
  category: z.enum(["hr", "finance", "procurement", "security", "software"]), title: z.string(), status: z.string(), statusLabel: z.string(),
  sourceId: z.string().regex(/^dev-[a-z0-9-]+$/), documentNumber: z.string(), skillId: z.string(),
  fields: z.array(z.object({ label: z.string(), value: z.string() })), sections: z.array(z.object({ heading: z.string(), content: z.string() })),
  relatedIds: z.array(z.string()), query: z.string(),
  action: z.object({ skillId: z.literal("create-it-ticket"), query: z.string(), parameters: ticketDetailsSchema }).nullable(),
});
export type EnterpriseRecord = z.infer<typeof enterpriseRecordSchema>;
export const enterpriseRecords = z.array(enterpriseRecordSchema).parse(pack.records);
export const enterpriseAsOf = pack.asOf;
export const enterpriseRecordById = new Map(enterpriseRecords.map((record) => [record.id, record]));

export function filterEnterpriseRecords(filters: { query: string; category: string; kind: string; status: string }) {
  const query = filters.query.trim().toLocaleLowerCase();
  return enterpriseRecords.filter((record) => (filters.category === "all" || filters.category === record.category)
    && (filters.kind === "all" || filters.kind === record.kind) && (filters.status === "all" || filters.status === record.status)
    && `${record.id} ${record.title} ${record.fields.map((field) => field.value).join(" ")} ${record.relatedIds.join(" ")}`.toLocaleLowerCase().includes(query));
}