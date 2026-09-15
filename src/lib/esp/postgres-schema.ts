import type { StateSql } from "./postgres";

export const stateSchemaVersion = 1;

const statements = [
  "CREATE SCHEMA IF NOT EXISTS esp_state",
  `CREATE TABLE IF NOT EXISTS esp_state.schema_versions (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS esp_state.approvals (
    id text PRIMARY KEY CHECK (id ~ '^apr-[a-f0-9]{32}$'),
    created_by text NOT NULL CHECK (length(created_by) > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','expired','executing','completed','execution_unknown')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    UNIQUE (id, created_by),
    record jsonb NOT NULL CHECK (
      jsonb_typeof(record) = 'object' AND record ?& ARRAY['id','createdBy','createdAt','updatedAt','status']
      AND record->>'id' = id AND record->>'createdBy' = created_by AND record->>'status' = status
      AND (record->>'createdAt')::timestamptz = created_at AND (record->>'updatedAt')::timestamptz = updated_at
    )
  )`,
  `CREATE TABLE IF NOT EXISTS esp_state.tickets (
    id text PRIMARY KEY CHECK (id ~ '^ESP-[0-9]{8}-[A-F0-9]{8}$'),
    created_by text NOT NULL CHECK (length(created_by) > 0),
    created_at timestamptz NOT NULL,
    approval_id text UNIQUE,
    FOREIGN KEY (approval_id, created_by) REFERENCES esp_state.approvals(id, created_by) DEFERRABLE INITIALLY DEFERRED,
    record jsonb NOT NULL CHECK (
      jsonb_typeof(record) = 'object' AND record ?& ARRAY['id','createdBy','createdAt']
      AND record->>'id' = id AND record->>'createdBy' = created_by
      AND (record->>'createdAt')::timestamptz = created_at
      AND (record->>'approvalId') IS NOT DISTINCT FROM approval_id
    )
  )`,
  "CREATE INDEX IF NOT EXISTS approvals_owner_order ON esp_state.approvals (created_by, created_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS approvals_owner_status ON esp_state.approvals (created_by, status, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS tickets_owner_order ON esp_state.tickets (created_by, created_at DESC, id DESC)",
  `CREATE TABLE IF NOT EXISTS esp_state.migration_runs (
    id uuid PRIMARY KEY,
    source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
    report jsonb NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now()
  )`,
  "INSERT INTO esp_state.schema_versions (version) VALUES (1) ON CONFLICT DO NOTHING",
];

export async function createStateSchema(sql: StateSql) {
  for (const statement of statements) await sql.query(statement);
}