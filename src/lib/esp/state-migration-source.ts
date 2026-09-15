import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { createHash } from "node:crypto";
import { text as readStreamText } from "node:stream/consumers";
import { z } from "zod";
import { approvalRecordSchema, type ApprovalRecord } from "./approval-contracts";
import { ticketReceiptSchema, type TicketExecutionResult } from "./contracts";

export type StateSnapshot = {
  tickets: TicketExecutionResult["ticket"][];
  approvals: ApprovalRecord[];
  skippedUnownedTickets: number;
  assertUnchanged: () => Promise<void>;
};

function containerClient() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error("AZURE_STORAGE_ACCOUNT is not configured");
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient("audit");
}

async function sourceFiles() {
  const files: { name: string; etag: string }[] = [];
  for (const prefix of ["tickets/", "approvals/"]) {
    for await (const item of containerClient().listBlobsFlat({ prefix, abortSignal: AbortSignal.timeout(60_000) })) {
      if (!/^(?:tickets\/ESP-\d{8}-[A-F0-9]{8}|approvals\/apr-[a-f0-9]{32})\.json$/.test(item.name) || !item.properties.etag) throw new Error("UNEXPECTED_STATE_SOURCE_BLOB");
      const etag = item.properties.etag;
      files.push({ name: item.name, etag: etag.startsWith('"') ? etag : `"${etag}"` });
      if (files.length > 2_000) throw new Error("STATE_MIGRATION_SOURCE_LIMIT");
    }
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function digest(files: { name: string; etag: string }[]) { return createHash("sha256").update(JSON.stringify(files)).digest("hex"); }

export async function readBlobStateSnapshot(): Promise<StateSnapshot> {
  const files = await sourceFiles();
  const sourceDigest = digest(files);
  const tickets: StateSnapshot["tickets"] = [];
  const approvals: ApprovalRecord[] = [];
  let skippedUnownedTickets = 0;
  const ticketSchema = ticketReceiptSchema.extend({ id: z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/), createdBy: z.string().min(1), createdAt: z.iso.datetime() });
  for (const file of files) {
    const response = await containerClient().getBlobClient(file.name).download(0, undefined, {
      conditions: { ifMatch: file.etag }, abortSignal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 412) throw new Error("STATE_SOURCE_CHANGED");
      throw error;
    });
    if (!response.readableStreamBody || !response.etag) throw new Error("STATE_SOURCE_RESPONSE_INCOMPLETE");
    let body: unknown;
    try { body = JSON.parse(await readStreamText(response.readableStreamBody)); } catch { throw new Error("INVALID_STATE_SOURCE_JSON"); }
    if (file.name.startsWith("tickets/")) {
      const owner = z.object({ createdBy: z.string().min(1) }).safeParse(body);
      if (!owner.success) { skippedUnownedTickets += 1; continue; }
      const parsed = ticketSchema.safeParse(body);
      if (!parsed.success || file.name !== `tickets/${parsed.data.id}.json`) throw new Error("INVALID_STATE_SOURCE_TICKET");
      tickets.push(parsed.data);
    } else {
      const parsed = approvalRecordSchema.safeParse(body);
      if (!parsed.success || file.name !== `approvals/${parsed.data.id}.json`) throw new Error("INVALID_STATE_SOURCE_APPROVAL");
      approvals.push(parsed.data);
    }
  }
  return { tickets, approvals, skippedUnownedTickets, assertUnchanged: async () => { if (digest(await sourceFiles()) !== sourceDigest) throw new Error("STATE_SOURCE_CHANGED"); } };
}