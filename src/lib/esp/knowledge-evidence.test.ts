import { describe, expect, it, vi } from "vitest";
import { prepareKnowledgeDocument } from "./knowledge-chunks";
import { knowledgeDocuments } from "./knowledge-corpus";
import { publishedKnowledgeSource, resolveKnowledgeEvidence } from "./knowledge-evidence";
import { searchChunks } from "./knowledge-publication";
import { answerKnowledge } from "./knowledge";

const document = prepareKnowledgeDocument({
  title: "Demo travel rule", skillId: "search-expense-policy", documentNumber: "SIM-FIN-TEST-001", owner: "Demo Finance",
  effectiveDate: "2026-09-10", dataKind: "policy", filename: "travel.md", content: "For simulation only: the orbital ferry limit is 280 credits.", simulated: true,
}, "kb-0123456789abcdef0123456789abcdef", "development:local", "2026-09-10T10:00:00.000Z");
const chunk = searchChunks(document)[0];

describe("published knowledge evidence", () => {
  it.each(["draft", "indexing", "inactive", "error"] as const)("ignores %s chunks even if search returns them", async (status) => {
    const load = vi.fn().mockResolvedValue({ document: { ...document, status }, etag: "v1" });
    expect(await resolveKnowledgeEvidence([chunk], document.skillId, load)).toEqual([]);
    expect(await publishedKnowledgeSource(chunk.id, load)).toBeNull();
  });

  it("accepts published chunks only when content matches the stored original", async () => {
    const load = vi.fn().mockResolvedValue({ document: { ...document, status: "published" }, etag: "v1" });
    const candidates = [chunk, { ...chunk, content: "Altered indexed content" }];
    expect(await resolveKnowledgeEvidence(candidates, document.skillId, load)).toEqual([chunk]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps built-in evidence available without a Blob dependency", async () => {
    const load = vi.fn();
    const source = knowledgeDocuments[0];
    expect(await resolveKnowledgeEvidence([source], source.skillId, load)).toEqual([source]);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not read an arbitrary path or accept another scenario", async () => {
    const load = vi.fn();
    expect(await publishedKnowledgeSource("../secrets", load)).toBeNull();
    expect(await resolveKnowledgeEvidence([chunk], "search-company-policy", load)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns a new-source citation only for a currently published document", async () => {
    const load = vi.fn().mockResolvedValue({ document: { ...document, status: "published" }, etag: "v1" });
    const result = await answerKnowledge(document.skillId, "orbital ferry limit", {
      retrieve: vi.fn().mockResolvedValue([chunk]),
      resolve: (documents, skillId) => resolveKnowledgeEvidence(documents, skillId, load),
      generate: vi.fn().mockResolvedValue({ supported: true, answer: "The simulated limit is 280 credits.", citations: [{ id: chunk.id, quote: chunk.content }] }),
      review: vi.fn().mockResolvedValue({ verdict: "supported", statements: [{ text: "The simulated limit is 280 credits.", supported: true, sourceIds: [chunk.id] }] }),
    });
    expect(result).toMatchObject({ type: "knowledge_answer", corpus: "dev-library", citations: [{ id: chunk.id, url: `/knowledge/${chunk.id}`, excerpt: chunk.content }] });
  });

  it("discards an answer if its document was deactivated during generation", async () => {
    const resolve = vi.fn().mockResolvedValueOnce([chunk]).mockResolvedValueOnce([]);
    const result = await answerKnowledge(document.skillId, "orbital ferry limit", {
      retrieve: vi.fn().mockResolvedValue([chunk]), resolve,
      generate: vi.fn().mockResolvedValue({ supported: true, answer: "280 credits", citations: [{ id: chunk.id, quote: chunk.content }] }),
    });
    expect(result).toMatchObject({ type: "knowledge_not_found", reason: "evidence_changed" });
  });

  it("discards an otherwise verified answer if publication is withdrawn during factual review", async () => {
    const resolve = vi.fn().mockResolvedValueOnce([chunk]).mockResolvedValueOnce([chunk]).mockResolvedValueOnce([]);
    const review = vi.fn().mockResolvedValue({ verdict: "supported", statements: [{ text: "280 credits", supported: true, sourceIds: [chunk.id] }] });
    const result = await answerKnowledge(document.skillId, "orbital ferry limit", {
      retrieve: vi.fn().mockResolvedValue([chunk]), resolve, review,
      generate: vi.fn().mockResolvedValue({ supported: true, answer: "280 credits", citations: [{ id: chunk.id, quote: chunk.content }] }),
    });
    expect(review).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ type: "knowledge_not_found", reason: "evidence_changed" });
  });
});