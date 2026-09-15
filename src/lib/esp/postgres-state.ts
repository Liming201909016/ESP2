import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ApprovalError, approvalIdSchema, approvalRecordSchema, type ApprovalRecord, type StoredApproval } from "./approval-contracts";
import { ticketReceiptSchema, type TicketExecutionResult } from "./contracts";
import { postgresSql, type StateSql } from "./postgres";

const ticketIdSchema = z.string().regex(/^ESP-\d{8}-[A-F0-9]{8}$/);
const storedTicketSchema = ticketReceiptSchema.extend({ id: ticketIdSchema, createdBy: z.string().min(1), createdAt: z.iso.datetime() });
const pageCursorSchema = z.object({ version: z.literal(1), createdAt: z.iso.datetime(), id: approvalIdSchema }).strict();
type TicketRecord = TicketExecutionResult["ticket"];
type ApprovalRow = { record: unknown; revision: string };

function approvalFrom(row: ApprovalRow): StoredApproval {
  const parsed = approvalRecordSchema.safeParse(row.record);
  if (!parsed.success || !/^[1-9]\d*$/.test(row.revision)) throw new Error("INVALID_PERSISTED_APPROVAL");
  return { record: parsed.data, etag: `pg:${row.revision}` };
}

function ticketFrom(row: { record: unknown }): TicketRecord {
  const parsed = storedTicketSchema.safeParse(row.record);
  if (!parsed.success) throw new Error("INVALID_PERSISTED_TICKET");
  return parsed.data;
}

function parseCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    if (!cursor.startsWith("pg:") || cursor.length > 1_000) throw new Error("Invalid cursor");
    return pageCursorSchema.parse(JSON.parse(Buffer.from(cursor.slice(3), "base64url").toString("utf8")));
  } catch { throw new ApprovalError("INVALID_CURSOR", 400); }
}

export function postgresStateStore(sql: StateSql = postgresSql) {
  return {
    async getTicket(id: string, owner: string): Promise<TicketRecord | null> {
      if (!ticketIdSchema.safeParse(id).success) return null;
      const { rows } = await sql.query<{ record: unknown }>("SELECT record FROM esp_state.tickets WHERE id = $1 AND created_by = $2", [id, owner]);
      return rows[0] ? ticketFrom(rows[0]) : null;
    },
    async saveTicket(ticket: TicketRecord) {
      const parsed = storedTicketSchema.parse(ticket);
      const body = JSON.stringify(parsed);
      const { rows } = await sql.query<{ record: unknown }>(
        "INSERT INTO esp_state.tickets (id, created_by, created_at, approval_id, record) VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb) ON CONFLICT DO NOTHING RETURNING record",
        [parsed.id, parsed.createdBy, parsed.createdAt, parsed.approvalId ?? null, body],
      );
      if (rows.length) return;
      const existing = await sql.query<{ record: unknown }>("SELECT record FROM esp_state.tickets WHERE id = $1 AND created_by = $2", [parsed.id, parsed.createdBy]);
      if (!existing.rows[0] || !isDeepStrictEqual(existing.rows[0].record, JSON.parse(body))) throw new Error(parsed.approvalId ? "APPROVAL_TICKET_CONFLICT" : "TICKET_CONFLICT");
    },
    async listTickets(owner: string, limit = 50): Promise<TicketRecord[]> {
      const count = z.number().int().min(1).max(100).parse(limit);
      const { rows } = await sql.query<{ record: unknown }>("SELECT record FROM esp_state.tickets WHERE created_by = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [owner, count]);
      return rows.map(ticketFrom);
    },
    async getApproval(id: string): Promise<StoredApproval | null> {
      approvalIdSchema.parse(id);
      const { rows } = await sql.query<ApprovalRow>("SELECT record, revision::text FROM esp_state.approvals WHERE id = $1", [id]);
      return rows[0] ? approvalFrom(rows[0]) : null;
    },
    async writeApproval(record: ApprovalRecord, etag: string | null): Promise<StoredApproval> {
      const parsed = approvalRecordSchema.parse(record);
      const values = [parsed.id, parsed.createdBy, parsed.createdAt, parsed.updatedAt, parsed.status, JSON.stringify(parsed)];
      let rows: ApprovalRow[];
      if (etag === null) {
        ({ rows } = await sql.query<ApprovalRow>("INSERT INTO esp_state.approvals (id, created_by, created_at, updated_at, status, record) VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6::jsonb) ON CONFLICT DO NOTHING RETURNING record, revision::text", values));
      } else {
        if (!/^pg:[1-9]\d{0,17}$/.test(etag)) throw new ApprovalError("CONFLICT", 409);
        ({ rows } = await sql.query<ApprovalRow>("UPDATE esp_state.approvals SET updated_at = $4::timestamptz, status = $5, record = $6::jsonb, revision = revision + 1 WHERE id = $1 AND created_by = $2 AND created_at = $3::timestamptz AND revision = $7::bigint RETURNING record, revision::text", [...values, etag.slice(3)]));
      }
      if (!rows[0]) throw new ApprovalError("CONFLICT", 409);
      return approvalFrom(rows[0]);
    },
    async listApprovals(owner: string, cursor?: string): Promise<{ approvals: StoredApproval[]; nextCursor: string | null }> {
      const after = parseCursor(cursor);
      const { rows } = await sql.query<ApprovalRow>(
        "SELECT record, revision::text FROM esp_state.approvals WHERE created_by = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text)) ORDER BY created_at DESC, id DESC LIMIT 21",
        [owner, after?.createdAt ?? null, after?.id ?? null],
      );
      const approvals = rows.slice(0, 20).map(approvalFrom);
      const last = approvals.at(-1)?.record;
      const nextCursor = rows.length > 20 && last ? `pg:${Buffer.from(JSON.stringify({ version: 1, createdAt: last.createdAt, id: last.id })).toString("base64url")}` : null;
      return { approvals, nextCursor };
    },
  };
}