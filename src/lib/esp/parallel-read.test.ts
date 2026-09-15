import { afterEach, describe, expect, it, vi } from "vitest";
import { executeParallelRead } from "./parallel-read";
import { parallelReadResultSchema } from "./parallel-read-contracts";
import { skillRegistry } from "./registry";
import type { IdentityContext } from "./identity";
import { KnowledgeVerificationError } from "./knowledge-grounding";
import { knowledgeDocuments } from "./knowledge-corpus";

const identity: IdentityContext = { authenticated: true, subject: "development:test", displayName: "Test", source: "development", permissions: ["knowledge.read", "tickets.read", "tickets.create"] };
const parent = { id: "aud-8210000000000-11111111111141118111111111111111", requestId: "11111111-1111-4111-8111-111111111111", traceId: "22222222-2222-4222-8222-222222222222" };
const source = knowledgeDocuments[0];
const answer = { type: "knowledge_answer" as const, corpus: "dev-samples" as const, answer: "A simulated policy response.", citations: [{ ...source, excerpt: source.content.slice(0, 100), url: `/knowledge/${source.id}` }] };
const missing = { type: "knowledge_not_found" as const, corpus: "dev-samples" as const };

function task(skillId: string, query = "A simulated independent request") {
  return { skill: skillRegistry.find((skill) => skill.id === skillId)!, query, parameters: {} };
}
const plan = [task("search-company-policy", "年假制度"), task("search-expense-policy", "北京差旅标准")];
function writer() { return { begin: vi.fn().mockResolvedValue(undefined), finish: vi.fn().mockResolvedValue(undefined) }; }
afterEach(() => vi.restoreAllMocks());

describe("bounded read-only orchestration", () => {
  it("starts two independent reads together, queues the third and preserves plan order", async () => {
    const releases = new Map<string, () => void>();
    let active = 0;
    let maximum = 0;
    const execute = vi.fn(async (skillId: string) => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.set(skillId, resolve));
      active -= 1;
      return answer;
    });
    const audit = writer();
    const resultPromise = executeParallelRead([...plan, task("search-procurement-guide")], identity, parent, { execute, writer: audit });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    releases.get("search-expense-policy")!();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    releases.get("search-procurement-guide")!(); releases.get("search-company-policy")!();
    const result = await resultPromise;
    expect(result.executionStatus).toBe("completed");
    expect(maximum).toBe(2);
    expect(result.tasks.map((entry) => entry.usage.skillId)).toEqual(["search-company-policy", "search-expense-policy", "search-procurement-guide"]);
    expect(audit.begin).toHaveBeenCalledTimes(3);
    expect(audit.finish).toHaveBeenCalledTimes(3);
    expect(result.tasks.every((entry) => entry.audit.traceId === parent.traceId && entry.audit.status === "recorded")).toBe(true);
    expect(new Set(result.tasks.map((entry) => entry.requestId)).size).toBe(3);
    expect(JSON.stringify(audit.begin.mock.calls)).not.toContain("年假制度");
  });

  it.each(["unavailable", "verification", "throttled"])("retains another task's result when one read is %s", async (failureKind) => {
    const execute = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(failureKind === "verification" ? new KnowledgeVerificationError("incomplete")
      : failureKind === "throttled" ? Object.assign(new Error("private response"), { status: 429, code: "rate_limit_exceeded", headers: new Headers({ "retry-after": "17" }) }) : new Error("private endpoint detail"));
    const result = await executeParallelRead(plan, identity, parent, { execute, writer: writer() });
    expect(result.executionStatus).toBe("partial");
    expect(result.tasks[0].execution).toMatchObject({ type: "knowledge_answer" });
    expect(result.tasks[1].execution).toBeNull();
    expect(result.tasks[1].error).toBe(failureKind === "verification" ? "KNOWLEDGE_VERIFICATION_FAILED" : failureKind === "throttled" ? "MODEL_RATE_LIMITED" : "READ_EXECUTION_FAILED");
    if (failureKind === "verification") expect(result.tasks[1].verificationReason).toBe("incomplete");
    if (failureKind === "throttled") expect(result.tasks[1].retryAfterSeconds).toBe(17);
    expect(JSON.stringify(result)).not.toMatch(/private response|private endpoint/);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("reports no usable results without pretending no evidence was a service outage", async () => {
    const result = await executeParallelRead(plan, identity, parent, { execute: vi.fn().mockResolvedValue(missing), writer: writer() });
    expect(result.executionStatus).toBe("no_result");
    expect(result.tasks.every((entry) => entry.executionStatus === "no_evidence" && !entry.error)).toBe(true);
  });

  it("reports all failures without fabricating an answer", async () => {
    const result = await executeParallelRead(plan, identity, parent, { execute: vi.fn().mockRejectedValue(new Error("outage")), writer: writer() });
    expect(result.executionStatus).toBe("failed");
    expect(result.tasks.every((entry) => entry.execution === null)).toBe(true);
  });

  it.each(["create-it-ticket", "unknown-skill"])("rejects an entire plan containing %s before any invocation or child audit", async (skillId) => {
    const execute = vi.fn(); const audit = writer();
    await expect(executeParallelRead([plan[0], { ...plan[1], skill: { ...plan[1].skill, id: skillId } }], identity, parent, { execute, writer: audit })).rejects.toThrow("not authorized");
    expect(execute).not.toHaveBeenCalled(); expect(audit.begin).not.toHaveBeenCalled();
  });

  it("revalidates actual permissions instead of trusting model-supplied skill metadata", async () => {
    const execute = vi.fn(); const audit = writer();
    const denied = [plan[0], { ...task("get-ticket-status"), skill: { ...task("get-ticket-status").skill, permissions: ["knowledge.read" as const] } }];
    await expect(executeParallelRead(denied, { ...identity, permissions: ["knowledge.read"] }, parent, { execute, writer: audit })).rejects.toThrow("not authorized");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects duplicates and more than three tasks before execution", async () => {
    const execute = vi.fn();
    for (const invalid of [[plan[0], plan[0]], [...plan, task("search-procurement-guide"), task("search-security-guidance")]]) {
      await expect(executeParallelRead(invalid, identity, parent, { execute, writer: writer() })).rejects.toThrow("not authorized");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not transfer an identifier from a sibling question to a ticket lookup", async () => {
    const execute = vi.fn();
    const ticket = { ...task("get-ticket-status", "工单状态"), parameters: { ticketId: "ESP-20260913-ABCDEF12" } };
    await expect(executeParallelRead([plan[0], ticket], identity, parent, { execute, writer: writer() })).rejects.toThrow("not authorized");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps missing ticket input isolated while another task succeeds", async () => {
    const execute = vi.fn().mockResolvedValueOnce(answer).mockResolvedValueOnce({ type: "input_required", field: "ticketId" });
    const result = await executeParallelRead([plan[0], task("get-ticket-status", "工单状态")], identity, parent, { execute, writer: writer() });
    expect(result.executionStatus).toBe("partial");
    expect(result.tasks[1].executionStatus).toBe("needs_input");
    expect(execute.mock.calls[1][2]).toBe(identity.subject);
    expect(execute.mock.calls[1][4]).toEqual({});
  });

  it("does not replay a successful read after audit finalization fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const audit = writer(); audit.finish.mockRejectedValue(new Error("audit unavailable"));
    const execute = vi.fn().mockResolvedValue(answer);
    const result = await executeParallelRead(plan, identity, parent, { execute, writer: audit });
    expect(result.executionStatus).toBe("completed");
    expect(result.tasks.every((entry) => entry.audit.status === "incomplete")).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects forged aggregate status and mismatched task identities", async () => {
    const result = await executeParallelRead(plan, identity, parent, { execute: vi.fn().mockResolvedValue(missing), writer: writer() });
    expect(parallelReadResultSchema.safeParse({ ...result, executionStatus: "completed" }).success).toBe(false);
    const changed = structuredClone(result); changed.tasks[1].requestId = changed.tasks[0].requestId;
    expect(parallelReadResultSchema.safeParse(changed).success).toBe(false);
  });

  it("rejects a read result bound to the wrong operation or contradictory failure metadata", async () => {
    const result = await executeParallelRead(plan, identity, parent, { execute: vi.fn().mockResolvedValue(answer), writer: writer() });
    const wrongOperation = structuredClone(result);
    wrongOperation.tasks[0].usage.plugin!.operationId = "tickets.get";
    expect(parallelReadResultSchema.safeParse(wrongOperation).success).toBe(false);
    const notInvoked = structuredClone(result); notInvoked.tasks[0].usage.invoked = false;
    expect(parallelReadResultSchema.safeParse(notInvoked).success).toBe(false);
    const extraRetry = structuredClone(result); extraRetry.tasks[0].retryAfterSeconds = 60;
    expect(parallelReadResultSchema.safeParse(extraRetry).success).toBe(false);
    const failed = await executeParallelRead(plan, identity, parent, { execute: vi.fn().mockRejectedValue(new Error("failed")), writer: writer() });
    failed.tasks[0].usage.plugin!.operationId = "tickets.create";
    expect(parallelReadResultSchema.safeParse(failed).success).toBe(false);
  });

  it("keeps completed results even when child audit starts cannot be stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const audit = writer(); audit.begin.mockRejectedValue(new Error("Blob unavailable"));
    const execute = vi.fn().mockResolvedValue(answer);
    const result = await executeParallelRead(plan, identity, parent, { execute, writer: audit });
    expect(result.executionStatus).toBe("completed");
    expect(result.tasks.every((entry) => entry.audit.status === "unavailable")).toBe(true);
    expect(audit.finish).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(2);
  });
});