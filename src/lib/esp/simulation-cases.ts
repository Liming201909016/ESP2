import { z } from "zod";
import cases from "../../data/simulation-cases.json";

const simulationCaseSchema = z.object({
  id: z.string().regex(/^SIM-QA-\d{3}$/),
  category: z.enum(["hr", "finance", "procurement", "security", "software"]),
  title: z.string().min(1),
  query: z.string().min(1).max(2_000),
  skillId: z.string().min(1),
  source: z.string().nullable(),
  alternateSources: z.array(z.string().min(1)).max(3).optional(),
  expected: z.enum(["answer", "no_evidence", "correction_or_no_evidence"]),
  expectedAnswer: z.string().min(1),
  facts: z.array(z.object({ label: z.string().min(1), anyOf: z.array(z.string().min(1)).min(1) })),
});

export type SimulationCase = z.infer<typeof simulationCaseSchema>;
export const simulationCases = z.array(simulationCaseSchema).parse(cases);
export const simulationCategories = {
  hr: "人事",
  finance: "财务",
  procurement: "采购",
  security: "信息安全",
  software: "软件服务",
} as const;