import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { text as readStreamText } from "node:stream/consumers";
import { isDeepStrictEqual } from "node:util";
import { ticketReceiptSchema as ticketRecordSchema, type TicketExecutionResult } from "./contracts";
import { z } from "zod";
import { postgresStateStore } from "./postgres-state";
import { assertStateWritesAvailable, stateBackend } from "./state-config";

export type TicketRecord = TicketExecutionResult["ticket"];

export function sameTicketReceipt(left: TicketRecord | null, right: TicketRecord) {
  return left !== null && isDeepStrictEqual(
    JSON.parse(JSON.stringify(ticketRecordSchema.parse(left))),
    JSON.parse(JSON.stringify(ticketRecordSchema.parse(right))),
  );
}

function containerClient() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT;
  if (!accountName) throw new Error("AZURE_STORAGE_ACCOUNT is not configured");

  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  ).getContainerClient("audit");
}

export async function saveTicket(ticket: TicketRecord) {
  assertStateWritesAvailable();
  if (stateBackend() === "postgres") return postgresStateStore().saveTicket(ticket);
  const blob = containerClient().getBlockBlobClient(`tickets/${ticket.id}.json`);
  const body = JSON.stringify(ticket);

  try {
    await blob.upload(body, Buffer.byteLength(body), {
      conditions: { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: "application/json" },
      abortSignal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "statusCode" in error && [409, 412].includes(Number(error.statusCode)))) throw error;
    if (!sameTicketReceipt(await getTicket(ticket.id, ticket.createdBy), ticket)) throw new Error("TICKET_CONFLICT");
  }
}

export async function saveApprovedTicket(ticket: TicketRecord) {
  assertStateWritesAvailable();
  const parsed = ticketRecordSchema.extend({
    id: z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/),
    approvalId: z.string().regex(/^apr-[a-f0-9]{32}$/),
  }).parse(ticket);
  if (stateBackend() === "postgres") return postgresStateStore().saveTicket(parsed);
  const body = JSON.stringify(parsed);
  try {
    await containerClient().getBlockBlobClient(`tickets/${parsed.id}.json`).upload(body, Buffer.byteLength(body), {
      conditions: { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
      abortSignal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const conflict = code === "BlobAlreadyExists" || code === "ConditionNotMet" || (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 412);
    if (!conflict) throw error;
    const existing = await getTicket(parsed.id, parsed.createdBy);
    if (!sameTicketReceipt(existing, parsed)) throw new Error("APPROVAL_TICKET_CONFLICT");
  }
}

export async function getTicket(ticketId: string, createdBy: string) {
  if (!/^ESP-\d{8}-[A-F0-9]{8}$/.test(ticketId)) return null;
  if (stateBackend() === "postgres") return postgresStateStore().getTicket(ticketId, createdBy);

  try {
    const response = await containerClient()
      .getBlobClient(`tickets/${ticketId}.json`)
      .download();
    if (!response.readableStreamBody) throw new Error("Ticket response has no body");
    const stored = JSON.parse(await readStreamText(response.readableStreamBody));
    const owner = z.object({ createdBy: z.string() }).safeParse(stored);
    if (!owner.success || owner.data.createdBy !== createdBy) return null;

    const ticket = ticketRecordSchema.parse(stored);
    return ticket.id === ticketId ? ticket : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "BlobNotFound") {
      return null;
    }
    throw error;
  }
}

export async function listTickets(createdBy: string, limit = 50) {
  if (stateBackend() === "postgres") return postgresStateStore().listTickets(createdBy, limit);
  const container = containerClient();
  const tickets: TicketRecord[] = [];
  let scanned = 0;

  for await (const item of container.listBlobsFlat({ prefix: "tickets/" })) {
    if (scanned >= 200) break;
    scanned += 1;

    try {
      const response = await container.getBlobClient(item.name).downloadToBuffer();
      const parsed = ticketRecordSchema.safeParse(
        JSON.parse(response.toString("utf8")),
      );
      if (parsed.success && parsed.data.createdBy === createdBy) {
        tickets.push(parsed.data);
      }
    } catch {
      continue;
    }
  }

  return tickets
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}