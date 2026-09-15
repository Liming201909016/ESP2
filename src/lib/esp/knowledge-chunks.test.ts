import { describe, expect, it } from "vitest";
import { chunkKnowledgeText, prepareKnowledgeDocument } from "./knowledge-chunks";
import { knowledgeImportSchema, managedDocumentSchema } from "./knowledge-library-contracts";

const id = "kb-0123456789abcdef0123456789abcdef";
const input = {
  title: "Demo travel rule", skillId: "search-expense-policy" as const,
  documentNumber: "SIM-FIN-DEMO-001", owner: "Finance demo team",
  effectiveDate: "2026-09-10", dataKind: "policy" as const,
  filename: "travel.md", content: "# Demo policy\nThis is a fictional policy for development tests.", simulated: true as const,
};

describe("knowledge import and chunk preview", () => {
  it("creates a draft with exact, reproducible source ranges", () => {
    const document = prepareKnowledgeDocument(input, id, "development:local", "2026-09-10T10:00:00.000Z");
    expect(managedDocumentSchema.parse(document)).toEqual(document);
    expect(document.status).toBe("draft");
    expect(document.chunks.map((chunk) => chunk.content).join("")).toBe(document.content);
    expect(document.chunks[0].id).toBe(`${id}-c001`);
    expect(chunkKnowledgeText(id, document.content)).toEqual(document.chunks);
  });

  it("normalizes BOM and newlines without interpreting markup", () => {
    const parsed = knowledgeImportSchema.parse({ ...input, content: "\uFEFF# Heading\r\n<script>example</script>\rEnd of simulated text\n" });
    expect(parsed.content).toBe("# Heading\n<script>example</script>\nEnd of simulated text");
  });

  it("bounds large chunks and preserves every character", () => {
    const text = Array.from({ length: 20 }, (_, index) => `Section ${index}\n${"text ".repeat(300)}\n`).join("");
    const chunks = chunkKnowledgeText(id, text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.content).join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1_800);
      expect(chunk.content).toBe(text.slice(chunk.start, chunk.end));
    }
  });

  it("does not split a UTF-16 surrogate pair", () => {
    const text = `${"a".repeat(1_799)}\uD83D\uDCA1${"b".repeat(2_000)}`;
    const chunks = chunkKnowledgeText(id, text);
    expect(chunks.map((chunk) => chunk.content).join("")).toBe(text);
    expect(chunks[0].content).toHaveLength(1_799);
  });

  it.each([
    { filename: "sample.pdf" }, { filename: "../sample.md" },
    { content: "short" }, { content: "a".repeat(48_001) },
    { content: "bad\u0000content here" }, { simulated: false },
    { skillId: "create-it-ticket" }, { effectiveDate: "2026-02-30" },
  ])("rejects unsupported imports: %j", (changes) => {
    expect(knowledgeImportSchema.safeParse({ ...input, ...changes }).success).toBe(false);
  });
});