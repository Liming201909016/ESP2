import { createHash } from "node:crypto";
import { z } from "zod";
import { createSecurityReview, decideSecurityReview, discoverSecurityReview, reviewCaseSchema, reviewIdSchema, SecurityReviewError } from "./security-review";
import { securityReviewStore, type SecurityReviewStore } from "./security-review-store";
import { assertStateWritesAvailable } from "./state-config";

export const securityReviewCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), submissionId: z.uuid(), caseId: reviewCaseSchema, query: z.string().trim().min(3).max(2000), previousReviewId: reviewIdSchema.nullable().optional() }).strict(),
  z.object({ action: z.enum(["approve", "reject", "request_information"]), id: reviewIdSchema, etag: z.string().min(1).max(200), reason: z.string().trim().min(3).max(1000) }).strict(),
]);
export async function executeSecurityReviewCommand(input: unknown, owner: string, requestId: string, store: SecurityReviewStore = securityReviewStore()) {
  const command = securityReviewCommandSchema.parse(input); assertStateWritesAvailable();
  if (!owner) throw new SecurityReviewError("REVIEW_NOT_FOUND", 403);
  if (command.action === "start") {
    if (!discoverSecurityReview(command.query)) throw new SecurityReviewError("REVIEW_SCOPE_UNSUPPORTED", 400);
    const id = `sr-${createHash("sha256").update(`${owner}:${command.submissionId}`).digest("hex").slice(0, 32)}`;
    const existing = await store.get(owner, id);
    const same = (stored: NonNullable<typeof existing>) => {
      if (stored.record.query !== command.query || stored.record.caseId !== command.caseId || stored.record.previousReviewId !== (command.previousReviewId ?? null)) throw new SecurityReviewError("REVIEW_CONFLICT", 409);
      return stored;
    };
    if (existing) return same(existing);
    if (command.previousReviewId) {
      const previous = await store.get(owner, command.previousReviewId);
      if (!previous || previous.record.status !== "needs_information") throw new SecurityReviewError("REVIEW_CONFLICT", 409);
    }
    const record = createSecurityReview({ id, submissionId: command.submissionId, caseId: command.caseId, query: command.query, previousReviewId: command.previousReviewId }, owner, requestId);
    try { return await store.put(record, null); }
    catch (error) {
      if (!(error instanceof SecurityReviewError) || error.code !== "REVIEW_CONFLICT") throw error;
      const concurrent = await store.get(owner, id); if (!concurrent) throw error; return same(concurrent);
    }
  }
  const current = await store.get(owner, command.id);
  if (!current) throw new SecurityReviewError("REVIEW_NOT_FOUND", 404);
  const desired = command.action === "approve" ? "approved" : command.action === "reject" ? "rejected" : "needs_information";
  if (current.record.status === desired && current.record.history.at(-1)?.reason === command.reason) return current;
  if (current.etag !== command.etag) throw new SecurityReviewError("REVIEW_CONFLICT", 409);
  return store.put(decideSecurityReview(current.record, command.action, command.reason, owner, requestId), current.etag);
}