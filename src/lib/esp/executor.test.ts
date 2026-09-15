import { describe, expect, it, vi } from "vitest";
import { executeSkill } from "./executor";
import { invokePlugin } from "./plugin-execution";
import { pluginOperations } from "./plugin-registry";
import { skillRegistry } from "./registry";

describe("executeSkill", () => {
  it("binds each registered skill to exactly one matching plugin operation", () => {
    for (const skill of skillRegistry) {
      const operations = pluginOperations.filter((operation) => operation.skillIds.some((id) => id === skill.id));
      expect(operations).toHaveLength(1);
      expect([...operations[0].permissions]).toEqual(skill.permissions);
      expect(operations[0].effect === "write").toBe(skill.confirmationRequired);
    }
  });

  it("does not invoke an operation for a different skill binding", async () => {
    const writeTicket = vi.fn();
    await expect(invokePlugin("tickets.create", {
      skillId: "search-company-policy", query: "leave policy", createdBy: "user-123", parameters: {},
    }, { writeTicket })).resolves.toEqual({ type: "unavailable", skillId: "search-company-policy" });
    expect(writeTicket).not.toHaveBeenCalled();
  });

  it("persists and returns a created ticket", async () => {
    const writeTicket = vi.fn().mockResolvedValue(undefined);

    const result = await executeSkill(
      "create-it-ticket",
      "  Laptop cannot connect to Wi-Fi  ",
      "user-123",
      { writeTicket },
      { description: "  Laptop cannot connect to Wi-Fi  ", impact: "individual", device: "SIM-LT-0042" },
    );

    expect(result).toMatchObject({
      type: "ticket_created",
      ticket: {
        status: "open",
        summary: "Laptop cannot connect to Wi-Fi",
        createdBy: "user-123",
        details: { description: "Laptop cannot connect to Wi-Fi", impact: "individual", device: "SIM-LT-0042" },
      },
    });
    if (result.type !== "ticket_created") throw new Error("Expected ticket receipt");
    expect(result.ticket.id).toMatch(/^ESP-\d{8}-[A-F0-9]{8}$/);
    expect(writeTicket).toHaveBeenCalledWith(result.ticket);
  });

  it("does not execute skills without an implementation", async () => {
    const writeTicket = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeSkill("unimplemented-skill", "vacation policy", "user-123", { writeTicket }),
    ).resolves.toEqual({ type: "unavailable", skillId: "unimplemented-skill" });
    expect(writeTicket).not.toHaveBeenCalled();
  });

  it("cannot persist a ticket without complete structured input", async () => {
    const writeTicket = vi.fn();
    await expect(executeSkill("create-it-ticket", "create ticket", "user-123", { writeTicket }))
      .resolves.toEqual({ type: "ticket_details_required", parameters: {}, missingFields: ["description", "impact"] });
    expect(writeTicket).not.toHaveBeenCalled();
  });

  it("reads a user-supplied identifier from the follow-up form", async () => {
    const readTicket = vi.fn().mockResolvedValue(null);
    await executeSkill("get-ticket-status", "find my record", "user-123", { readTicket }, { ticketId: "ESP-20260910-ABCDEF12" });
    expect(readTicket).toHaveBeenCalledWith("ESP-20260910-ABCDEF12", "user-123");
  });

  it("queries a canonical ticket ID with the current owner", async () => {
    const ticket = {
      id: "ESP-20260910-ABCDEF12",
      status: "open" as const,
      summary: "Network failure",
      createdAt: "2026-09-10T10:00:00.000Z",
      createdBy: "user-123",
    };
    const readTicket = vi.fn().mockResolvedValue(ticket);
    const writeTicket = vi.fn();

    await expect(executeSkill(
      "get-ticket-status", "ticket status esp-20260910-abcdef12", "user-123",
      { writeTicket, readTicket },
    )).resolves.toEqual({ type: "ticket_status", ticket });
    expect(readTicket).toHaveBeenCalledWith(ticket.id, "user-123");
    expect(writeTicket).not.toHaveBeenCalled();
  });

  it.each([
    "ticket status",
    "ticket status INC-2048",
    "ticket status ESP-20260910-ABCDEF12 and ESP-20260910-12345678",
  ])("requests a single valid ticket ID for %s", async (query) => {
    const readTicket = vi.fn();
    const writeTicket = vi.fn();
    await expect(executeSkill(
      "get-ticket-status", query, "user-123", { writeTicket, readTicket },
    )).resolves.toEqual({ type: "input_required", field: "ticketId" });
    expect(readTicket).not.toHaveBeenCalled();
    expect(writeTicket).not.toHaveBeenCalled();
  });

  it("returns not found when the owner has no matching record", async () => {
    await expect(executeSkill(
      "get-ticket-status", "ticket status ESP-20260910-ABCDEF12", "user-123",
      { writeTicket: vi.fn(), readTicket: vi.fn().mockResolvedValue(null) },
    )).resolves.toEqual({ type: "ticket_not_found", ticketId: "ESP-20260910-ABCDEF12" });
  });

  it("executes a knowledge skill through the grounded answer adapter", async () => {
    const answerKnowledge = vi.fn().mockResolvedValue({ type: "knowledge_not_found", corpus: "dev-samples" });
    const writeTicket = vi.fn();
    await expect(executeSkill("search-company-policy", "leave policy", "user-123", {
      answerKnowledge, writeTicket,
    })).resolves.toEqual({ type: "knowledge_not_found", corpus: "dev-samples" });
    expect(answerKnowledge).toHaveBeenCalledWith("search-company-policy", "leave policy");
    expect(writeTicket).not.toHaveBeenCalled();
  });
});