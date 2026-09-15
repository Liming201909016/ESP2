import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { postgresConnectionOptions } from "./state-config";
import { postgresCredentials, PostgresSecretError } from "./postgres-secret";

export type StateSql = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};

const sessions = new AsyncLocalStorage<StateSql>();
let pool: Promise<Pool> | undefined;

export class PostgresStateError extends Error {
  constructor(public code: "POSTGRES_STATE_FAILED" | "POSTGRES_COMMIT_UNCERTAIN", public sqlState?: string, public connectionCode?: string) { super(code); }
}

function sqlState(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined;
}

function connectionCode(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) return code;
  if (error instanceof Error && /^(Connection terminated due to connection timeout|timeout exceeded when trying to connect)$/.test(error.message)) return "CONNECTION_TIMEOUT";
  return undefined;
}

function connectionPool() {
  if (!pool) {
    pool = postgresCredentials().then((environment) => {
      const client = new Pool(postgresConnectionOptions(environment));
      client.on("error", (error) => console.error("postgres.pool.failed", { code: sqlState(error), connectionCode: connectionCode(error) }));
      return client;
    }).catch((error) => { pool = undefined; throw error; });
  }
  return pool;
}

export const postgresSql: StateSql = {
  async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]) {
    try { return { rows: (await (sessions.getStore() ?? await connectionPool()).query<Row>(text, values)).rows }; }
    catch (error) {
      if (error instanceof PostgresSecretError) throw error;
      if (error instanceof Error && /^POSTGRES_CONFIGURATION_INVALID:[a-z,]+$/.test(error.message)) throw error;
      throw new PostgresStateError("POSTGRES_STATE_FAILED", sqlState(error), connectionCode(error));
    }
  },
};

export function withPostgresExecutor<Result>(executor: StateSql, work: () => Promise<Result>) {
  return sessions.run(executor, work);
}

export async function inPostgresTransaction<Result>(work: () => Promise<Result>): Promise<Result> {
  if (sessions.getStore()) return work();
  const client = await (await connectionPool()).connect().catch((error: unknown) => { throw new PostgresStateError("POSTGRES_STATE_FAILED", sqlState(error), connectionCode(error)); });
  let committing = false;
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    const result = await withPostgresExecutor(client, work);
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    if (committing) { discard = true; throw new PostgresStateError("POSTGRES_COMMIT_UNCERTAIN", sqlState(error), connectionCode(error)); }
    throw error;
  } finally { client.release(discard); }
}