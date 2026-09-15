import { z } from "zod";
import type { KnowledgeAnswerResult, KnowledgeMissingResult } from "./contracts";
import { knowledgeBaseForSkill, managedKnowledgeCorpus, type KnowledgeDocument } from "./knowledge-corpus";
import { resolveKnowledgeEvidence } from "./knowledge-evidence";
import { assertFactualReview, assertGroundedNumbers, groundedDraftSchema, KnowledgeVerificationError } from "./knowledge-grounding";
import { generateGroundedAnswer, reviewGroundedAnswer } from "./knowledge-model";
import { retrieveKnowledge } from "./knowledge-search";

function sourceQuotation(content: string, quote: string) {
  const position = content.indexOf(quote);
  if (position < 0 || !quote.trim()) throw new KnowledgeVerificationError("invalid_citation", "Grounded answer contains an invalid citation");
  let start = position;
  let end = position + quote.length;
  if (quote.length < 8) {
    if (position !== content.lastIndexOf(quote)) throw new KnowledgeVerificationError("invalid_citation", "Grounded answer contains an ambiguous short citation");
    start = Math.max(0, content.lastIndexOf("\n", position - 1) + 1);
    const lineEnd = content.indexOf("\n", end);
    end = lineEnd === -1 ? content.length : lineEnd;
    if (end - start < 8 && end < content.length) {
      const nextEnd = content.indexOf("\n", end + 1);
      end = nextEnd === -1 ? content.length : nextEnd;
    }
    if (end - start < 8 || end - start > 500) {
      start = Math.max(0, position - 40);
      end = Math.min(content.length, position + quote.length + 40);
    }
  }
  for (const literal of content.matchAll(/[+\-\u2212]?[0-9\uFF10-\uFF19]+(?:[,.\uFF0C\uFF0E][0-9\uFF10-\uFF19]+)*(?:[eE][+-]?[0-9\uFF10-\uFF19]+)?/gu)) {
    const literalEnd = literal.index + literal[0].length;
    if (literal.index < start && start < literalEnd) start = literal.index;
    if (literal.index < end && end < literalEnd) end = literalEnd;
  }
  const excerpt = z.string().min(8).max(500).safeParse(content.slice(start, end));
  if (!excerpt.success) throw new KnowledgeVerificationError("invalid_citation", "Grounded answer contains an invalid citation length");
  return excerpt.data;
}

type KnowledgeDependencies = {
  retrieve: (skillId: string, query: string) => Promise<KnowledgeDocument[]>;
  generate: typeof generateGroundedAnswer;
  review: typeof reviewGroundedAnswer;
  resolve: typeof resolveKnowledgeEvidence;
  now: () => Date;
};

export async function answerKnowledge(
  skillId: string,
  query: string,
  dependencies: Partial<KnowledgeDependencies> = {},
): Promise<KnowledgeAnswerResult | KnowledgeMissingResult> {
  const retrieve = dependencies.retrieve ?? retrieveKnowledge;
  const generate = dependencies.generate ?? generateGroundedAnswer;
  const review = dependencies.review ?? reviewGroundedAnswer;
  const resolve = dependencies.resolve ?? resolveKnowledgeEvidence;
  const asOfDate = (dependencies.now?.() ?? new Date()).toISOString().slice(0, 10);
  const retrieved = await retrieve(skillId, query);
  if (!retrieved.length) return { type: "knowledge_not_found", corpus: "dev-samples", reason: "no_search_results" };
  const documents = (await resolve(retrieved, skillId)).filter((source) => source.effectiveDate <= asOfDate);
  if (!documents.length) return { type: "knowledge_not_found", corpus: "dev-samples", reason: "no_current_evidence" };

  const parsed = groundedDraftSchema.safeParse(await generate(query, documents, asOfDate));
  if (!parsed.success) throw new KnowledgeVerificationError("invalid_draft", "Grounded answer does not match its output contract");
  const draft = parsed.data;
  if (!draft.supported) return { type: "knowledge_not_found", corpus: "dev-samples", reason: "model_unsupported" };
  if (!draft.answer.trim() || !draft.citations.length) throw new KnowledgeVerificationError("invalid_citation", "Grounded answer is missing evidence");

  if (documents.some((source) => source.corpus === managedKnowledgeCorpus)) {
    const currentSources = await resolve(documents, skillId);
    if (draft.citations.some((citation) => !currentSources.some((source) => source.id === citation.id))) {
      return { type: "knowledge_not_found", corpus: "dev-samples", reason: "evidence_changed" };
    }
  }

  const citations = draft.citations.map((citation) => {
    const source = documents.find((document) => document.id === citation.id);
    if (!source) {
      throw new KnowledgeVerificationError("invalid_citation", "Grounded answer contains an invalid citation");
    }
    const excerpt = sourceQuotation(source.content, citation.quote);
    return {
      id: source.id,
      title: source.title,
      section: source.section,
      version: source.version,
      organization: source.organization,
      documentNumber: source.documentNumber,
      owner: source.owner,
      effectiveDate: source.effectiveDate,
      dataKind: source.dataKind,
      url: `/knowledge/${source.id}`,
      excerpt,
    };
  });
  const answer = draft.answer.trim();
  assertGroundedNumbers(answer, citations, draft.calculations);
  const reviewInput = { answer, citations, calculations: draft.calculations, asOfDate };
  assertFactualReview(reviewInput, await review(query, documents, reviewInput));
  if (documents.some((source) => source.corpus === managedKnowledgeCorpus)) {
    const currentSources = await resolve(documents, skillId);
    if (citations.some((citation) => !currentSources.some((source) => source.id === citation.id && source.effectiveDate <= asOfDate))) {
      return { type: "knowledge_not_found", corpus: "dev-samples", reason: "evidence_changed" };
    }
  }
  return {
    type: "knowledge_answer",
    knowledgeBase: knowledgeBaseForSkill(skillId),
    corpus: citations.some((citation) => documents.some((source) => source.id === citation.id && source.corpus === managedKnowledgeCorpus)) ? "dev-library" : "dev-samples",
    answer, citations,
  };
}