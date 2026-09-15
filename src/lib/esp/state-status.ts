import { postgresSql, type StateSql } from "./postgres";
import { stateMigrationReportSchema } from "./state-migration";
import { stateSchemaVersion } from "./postgres-schema";

export async function postgresStateStatus(owner: string, sql: StateSql = postgresSql) {
  const schema = await sql.query<{ schema_table: string | null }>("SELECT to_regclass('esp_state.schema_versions')::text AS schema_table");
  if (!schema.rows[0]?.schema_table) return { reachable: true, prepared: false, schemaVersion: null, counts: null, lastMigration: null };
  const versions = await sql.query<{ version: number }>("SELECT version FROM esp_state.schema_versions ORDER BY version DESC LIMIT 1");
  const rows = await sql.query<{ report: unknown }>("SELECT report FROM esp_state.migration_runs ORDER BY completed_at DESC, id DESC LIMIT 1");
  const migration = stateMigrationReportSchema.safeParse(rows.rows[0]?.report);
  const counts = await sql.query<{ tickets: string; approvals: string }>("SELECT (SELECT count(*)::text FROM esp_state.tickets WHERE created_by = $1) AS tickets, (SELECT count(*)::text FROM esp_state.approvals WHERE created_by = $1) AS approvals", [owner]);
  return {
    reachable: true, prepared: versions.rows[0]?.version === stateSchemaVersion && migration.success,
    schemaVersion: versions.rows[0]?.version ?? null,
    counts: { tickets: Number(counts.rows[0].tickets), approvals: Number(counts.rows[0].approvals) },
    lastMigration: migration.success ? migration.data : null,
  };
}