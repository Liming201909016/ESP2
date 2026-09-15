import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

const { download, getBlobClient, getBlockBlobClient, upload } = vi.hoisted(() => ({
  download: vi.fn(),
  getBlobClient: vi.fn(),
  getBlockBlobClient: vi.fn(), upload: vi.fn(),
}));

vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    getContainerClient() {
      return { getBlobClient, getBlockBlobClient };
    }
  },
}));

import { getTicket, saveApprovedTicket, saveTicket } from "./ticket-store";

const ticket = {
  id: "ESP-20260910-ABCDEF12",
  status: "open",
  summary: "Laptop network failure",
  createdAt: "2026-09-10T10:00:00.000Z",
  createdBy: "development:local",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AZURE_STORAGE_ACCOUNT", "testaccount");
  getBlobClient.mockReturnValue({ download });
  getBlockBlobClient.mockReturnValue({ upload });
  download.mockImplementation(async () => ({
    readableStreamBody: Readable.from([JSON.stringify(ticket)]),
  }));
});

afterEach(() => vi.unstubAllEnvs());

describe("conditional approval ticket writes", () => {
  it("uses create-only persistence for individual tickets and accepts only an identical receipt", async () => {
    await saveTicket({ ...ticket, status: "open" });
    expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    upload.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    await expect(saveTicket({ ...ticket, status: "open" })).resolves.toBeUndefined();
    await expect(saveTicket({ ...ticket, status: "open", summary: "Different input" })).rejects.toThrow("TICKET_CONFLICT");
  });
  const approved = { ...ticket, status: "open" as const, approvalId: `apr-${"a".repeat(32)}`, details: { description: ticket.summary, impact: "team" as const } };
  it("creates only when the reserved ticket ID is absent", async () => {
    await saveApprovedTicket(approved);
    expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(Number), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    expect(JSON.parse(upload.mock.calls[0][0])).toEqual(approved);
  });
  it("accepts a retry only for the exact same persisted approval receipt", async () => {
    upload.mockRejectedValue(Object.assign(new Error("Already exists"), { code: "BlobAlreadyExists" }));
    download.mockResolvedValue({ readableStreamBody: Readable.from([JSON.stringify(approved)]) });
    await expect(saveApprovedTicket(approved)).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("compares optional fields by their stored JSON representation", async () => {
    upload.mockRejectedValue(Object.assign(new Error("Already exists"), { code: "BlobAlreadyExists" }));
    download.mockResolvedValue({ readableStreamBody: Readable.from([JSON.stringify(approved)]) });
    await expect(saveApprovedTicket({ ...approved, details: { ...approved.details, device: undefined } })).resolves.toBeUndefined();
  });
  it.each([ticket, { ...approved, summary: "Changed input" }, { ...approved, createdBy: "another-user" }])("never overwrites a conflicting record", async (existing) => {
    upload.mockRejectedValue(Object.assign(new Error("Condition failed"), { statusCode: 412 }));
    download.mockResolvedValue({ readableStreamBody: Readable.from([JSON.stringify(existing)]) });
    await expect(saveApprovedTicket(approved)).rejects.toThrow("APPROVAL_TICKET_CONFLICT");
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("propagates an unknown write outcome for workflow reconciliation", async () => {
    const error = new Error("Connection lost"); upload.mockRejectedValue(error);
    await expect(saveApprovedTicket(approved)).rejects.toBe(error);
    expect(download).not.toHaveBeenCalled();
  });
});

describe("getTicket", () => {
  it("reads a ticket directly by ID for its owner", async () => {
    await expect(getTicket(ticket.id, ticket.createdBy)).resolves.toEqual(ticket);
    expect(getBlobClient).toHaveBeenCalledWith(`tickets/${ticket.id}.json`);
    expect(download).toHaveBeenCalledOnce();
  });

  it("does not return another owner's ticket", async () => {
    await expect(getTicket(ticket.id, "another-subject")).resolves.toBeNull();
  });

  it("does not return legacy records without an owner", async () => {
    download.mockResolvedValue({
      readableStreamBody: Readable.from([JSON.stringify({ ...ticket, createdBy: undefined })]),
    });
    await expect(getTicket(ticket.id, ticket.createdBy)).resolves.toBeNull();
  });

  it("returns null only for a missing blob", async () => {
    download.mockRejectedValue(
      Object.assign(new Error("Missing blob"), { code: "BlobNotFound" }),
    );
    await expect(getTicket(ticket.id, ticket.createdBy)).resolves.toBeNull();
  });

  it("propagates dependency failures instead of reporting not found", async () => {
    const error = Object.assign(new Error("Storage unavailable"), {
      code: "AuthorizationFailure",
    });
    download.mockRejectedValue(error);
    await expect(getTicket(ticket.id, ticket.createdBy)).rejects.toBe(error);
  });

  it("rejects malformed stored JSON", async () => {
    download.mockResolvedValue({ readableStreamBody: Readable.from(["not-json"]) });
    await expect(getTicket(ticket.id, ticket.createdBy)).rejects.toThrow();
  });

  it("does not disguise a missing container as a missing ticket", async () => {
    const error = Object.assign(new Error("Missing container"), {
      code: "ContainerNotFound", statusCode: 404,
    });
    download.mockRejectedValue(error);
    await expect(getTicket(ticket.id, ticket.createdBy)).rejects.toBe(error);
  });

  it("fails when storage returns no content stream", async () => {
    download.mockResolvedValue({ readableStreamBody: undefined });
    await expect(getTicket(ticket.id, ticket.createdBy)).rejects.toThrow("no body");
  });

  it.each(["../secrets", "INC-2048", "ESP-20260910-ABCDEF12/extra"])(
    "does not read an invalid ticket ID: %s",
    async (ticketId) => {
      await expect(getTicket(ticketId, ticket.createdBy)).resolves.toBeNull();
      expect(getBlobClient).not.toHaveBeenCalled();
    },
  );
});