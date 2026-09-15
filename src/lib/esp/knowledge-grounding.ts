import Decimal from "decimal.js";
import { z } from "zod";
import type { KnowledgeVerificationReason } from "./contracts";

const ExactDecimal = Decimal.clone({ precision: 256 });
export const groundedDecimalPattern = "^-?(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,6})?$";
const decimalValue = z.string().regex(new RegExp(groundedDecimalPattern));

export const groundedCalculationSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  operands: z.array(z.object({
    sourceId: z.string().min(1).max(100),
    quote: z.string().min(8).max(500),
    value: decimalValue,
  }).strict()).min(2).max(8),
  result: decimalValue,
}).strict();

export const groundedDraftSchema = z.object({
  supported: z.boolean(),
  answer: z.string().max(6_000),
  citations: z.array(z.object({ id: z.string(), quote: z.string().min(1).max(500) }).strict()).max(5),
  calculations: z.array(groundedCalculationSchema).max(5).default([]),
}).strict();

export type GroundedCalculation = z.infer<typeof groundedCalculationSchema>;
export type GroundedEvidence = {
  id: string;
  title?: string;
  excerpt: string;
  documentNumber: string;
  effectiveDate: string;
  version: string;
};

export type GroundedReviewInput = {
  answer: string;
  citations: GroundedEvidence[];
  calculations: GroundedCalculation[];
  asOfDate: string;
};

export const factualVerdicts = ["supported", "unsupported", "incomplete", "conflicting", "stale"] as const;
export class KnowledgeVerificationError extends Error {
  readonly code = "KNOWLEDGE_VERIFICATION_FAILED";
  readonly reason: KnowledgeVerificationReason;

  constructor(reason: KnowledgeVerificationReason, message = "Grounded answer failed factual verification") {
    super(message);
    this.name = "KnowledgeVerificationError";
    this.reason = reason;
  }
}

const factualReviewSchema = z.object({
  verdict: z.enum(factualVerdicts),
  statements: z.array(z.object({
    text: z.string().min(1).max(6_000),
    supported: z.boolean(),
    sourceIds: z.array(z.string().min(1).max(100)).max(5),
  }).strict()).min(1).max(24),
}).strict();

export function assertFactualReview(input: GroundedReviewInput, value: unknown) {
  const parsed = factualReviewSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeVerificationError("invalid_review");
  if (parsed.data.verdict !== "supported") throw new KnowledgeVerificationError(parsed.data.verdict);
  const statements = parsed.data.statements;
  if (statements.map((statement) => statement.text).join("") !== input.answer) {
    throw new KnowledgeVerificationError("incomplete_review", "Grounded factual review does not cover the entire answer");
  }
  const sourceIds = new Set(input.citations.map((source) => source.id));
  if (statements.some((statement) => !statement.supported || !statement.sourceIds.length ||
    new Set(statement.sourceIds).size !== statement.sourceIds.length || statement.sourceIds.some((id) => !sourceIds.has(id)))) {
    throw new KnowledgeVerificationError("unverified_statement", "Grounded answer contains an unverified statement");
  }
  for (const statement of statements) {
    const evidence = input.citations.filter((citation) => statement.sourceIds.includes(citation.id));
    const numbers = numericFacts(statement.text, true);
    const calculations = input.calculations.filter((calculation) => numbers.includes(normalizedNumber(calculation.result, true)) &&
      calculation.operands.every((operand) => statement.sourceIds.includes(operand.sourceId)));
    assertGroundedNumbers(statement.text, evidence, calculations);
  }
}

function normalizedNumber(value: string, signed = false) {
  const literal = value.replaceAll(",", "").toLowerCase();
  const negative = signed && literal.startsWith("-");
  const unsigned = literal.replace(/^[+-]/, "");
  if (unsigned.includes("e")) return `${negative ? "-" : ""}${unsigned}`;
  const [integer, decimal] = unsigned.split(".");
  const fraction = decimal?.replace(/0+$/, "");
  const normalized = `${integer.replace(/^0+(?=\d)/, "")}${fraction ? `.${fraction}` : ""}`;
  return `${negative && normalized !== "0" ? "-" : ""}${normalized}`;
}

function numericFacts(text: string, signed = false) {
  return (text.normalize("NFKC").replaceAll("\u2212", "-")
    .match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [])
    .map((value) => normalizedNumber(value, signed));
}

export function assertGroundedNumbers(answer: string, citations: GroundedEvidence[], calculations: GroundedCalculation[] = []) {
  let factualText = answer;
  for (const citation of citations) {
    if (citation.title) factualText = factualText.replaceAll(`《${citation.title}》`, " ");
  }
  const sourceNumbers = new Set(citations.flatMap((source) => numericFacts([
    source.excerpt, source.documentNumber, source.effectiveDate, source.version,
  ].join("\n"))));
  const answerNumbers = numericFacts(factualText, true);
  for (const calculation of calculations) {
    const parsed = groundedCalculationSchema.safeParse(calculation);
    if (!parsed.success) throw new KnowledgeVerificationError("invalid_calculation", "Grounded answer contains an invalid calculation");
    const { operation, operands, result } = parsed.data;
    if (operation === "divide" && operands.length !== 2) {
      throw new KnowledgeVerificationError("invalid_calculation", "Grounded answer contains an invalid calculation");
    }
    for (const operand of operands) {
      const value = normalizedNumber(operand.value, true);
      const supported = citations.some((citation) => citation.id === operand.sourceId && citation.excerpt.includes(operand.quote) && numericFacts(citation.excerpt, true).includes(value));
      if (!supported || !numericFacts(operand.quote, true).includes(value)) {
        throw new KnowledgeVerificationError("invalid_calculation", "Grounded answer contains an unsourced calculation operand");
      }
    }
    const values = operands.map((operand) => new ExactDecimal(operand.value));
    const computed = values.slice(1).reduce((total, value) => {
      switch (operation) {
        case "add": return total.plus(value);
        case "subtract": return total.minus(value);
        case "multiply": return total.times(value);
        case "divide": return total.dividedBy(value);
      }
    }, values[0]);
    if (!computed.isFinite() || !computed.equals(result) || !answerNumbers.includes(normalizedNumber(result, true))) {
      throw new KnowledgeVerificationError("invalid_calculation", "Grounded answer contains an incorrect or unused calculation result");
    }
    sourceNumbers.add(normalizedNumber(result));
  }
  if (numericFacts(factualText).some((value) => !sourceNumbers.has(value))) {
    throw new KnowledgeVerificationError("unsupported_number", "Grounded answer contains an unsupported numeric fact");
  }
}