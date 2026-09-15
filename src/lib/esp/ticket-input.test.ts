import { describe, expect, it } from "vitest";
import { skillParametersSchema, ticketDetailsSchema } from "./contracts";
import { missingTicketFields, ticketIdsInQuery } from "./ticket-input";

describe("structured ticket parameters", () => {
  it("requires a meaningful description and explicit impact", () => {
    expect(missingTicketFields({})).toEqual(["description", "impact"]);
    expect(missingTicketFields({ description: "  " })).toEqual(["description", "impact"]);
    expect(missingTicketFields({ description: "Laptop has no network" })).toEqual(["impact"]);
    expect(missingTicketFields({ impact: "team" })).toEqual(["description"]);
  });

  it("accepts complete input without a device identifier", () => {
    const input = ticketDetailsSchema.parse({ description: "  Laptop has no network  ", impact: "individual" });
    expect(input.description).toBe("Laptop has no network");
    expect(missingTicketFields(input)).toEqual([]);
  });

  it.each([
    { description: "Network issue", impact: "urgent" },
    { description: "Network issue", impact: "team", approved: true },
    { device: "x".repeat(121) },
    { ticketId: "../another-record" },
  ])("rejects invalid structured parameters: %j", (input) => {
    expect(skillParametersSchema.safeParse(input).success).toBe(false);
  });

  it("normalizes supplied ticket identifiers", () => {
    expect(skillParametersSchema.parse({ ticketId: " esp-20260910-abcdef12 " }).ticketId).toBe("ESP-20260910-ABCDEF12");
    expect(ticketIdsInQuery("Check esp-20260910-abcdef12 and ESP-20260910-ABCDEF12"))
      .toEqual(["ESP-20260910-ABCDEF12"]);
    expect(ticketIdsInQuery("ticket status INC-2048")).toEqual([]);
  });
});