import { beforeEach, describe, expect, it, vi } from "vitest";

const { connect, query, poolQuery, release } = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), poolQuery: vi.fn(), release: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { connect = connect; query = poolQuery; on() { return this; } } }));
const { connectionOptions } = vi.hoisted(() => ({ connectionOptions: vi.fn(() => ({})) }));
vi.mock("./state-config", () => ({ postgresConnectionOptions: connectionOptions }));
import { inPostgresTransaction, postgresSql } from "./postgres";
import { PostgresStateError } from "./postgres";
import { approvalErrorResponse } from "./approval-api";

beforeEach(() => { vi.clearAllMocks(); connect.mockResolvedValue({ query, release }); query.mockResolvedValue({ rows: [] }); poolQuery.mockResolvedValue({ rows: [] }); });

describe("PostgreSQL connection transaction boundary", () => {
  it("preserves only the safe configuration-field diagnostic", async () => {
    vi.resetModules();
    connectionOptions.mockImplementationOnce(() => { throw new Error("POSTGRES_CONFIGURATION_INVALID:password"); });
    const isolated = await import("./postgres");
    await expect(isolated.postgresSql.query("SELECT 1")).rejects.toThrow("POSTGRES_CONFIGURATION_INVALID:password");
    expect(poolQuery).not.toHaveBeenCalled();
  });
  it("keeps nested work on one connection until commit", async () => {
    await inPostgresTransaction(async () => { await postgresSql.query("SELECT $1 AS value", [1]); await inPostgresTransaction(() => postgresSql.query("SELECT $1 AS value", [2])); });
    expect(connect).toHaveBeenCalledTimes(1); expect(poolQuery).not.toHaveBeenCalled();
    expect(query.mock.calls.map(([text]) => text)).toEqual(["BEGIN", "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '30s'", "SELECT $1 AS value", "SELECT $1 AS value", "COMMIT"]);
    expect(release).toHaveBeenCalledWith(false);
  });
  it("rolls back business errors and does not retry the callback", async () => {
    const error = new Error("Synthetic workflow failure"); const work = vi.fn(async () => { throw error; });
    await expect(inPostgresTransaction(work)).rejects.toBe(error);
    expect(query).toHaveBeenLastCalledWith("ROLLBACK"); expect(work).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledWith(false);
  });
  it("reports uncertain commit without retrying a potentially committed write", async () => {
    query.mockImplementation(async (text: string) => { if (text === "COMMIT") throw Object.assign(new Error("private server detail"), { code: "08006" }); return { rows: [] }; });
    const work = vi.fn(async () => "possible receipt");
    await expect(inPostgresTransaction(work)).rejects.toMatchObject({ code: "POSTGRES_COMMIT_UNCERTAIN", sqlState: "08006", message: "POSTGRES_COMMIT_UNCERTAIN" });
    expect(work).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledWith(true);
  });
  it("removes raw database details from ordinary query failures", async () => {
    poolQuery.mockRejectedValue(Object.assign(new Error("private row and credential text"), { code: "23514", detail: "private detail" }));
    await expect(postgresSql.query("SELECT 1")).rejects.toMatchObject({ code: "POSTGRES_STATE_FAILED", sqlState: "23514", message: "POSTGRES_STATE_FAILED" });
  });
  it("reports allowlisted connection errors without including secret text", async () => {
    poolQuery.mockRejectedValue(Object.assign(new Error("private server and credential details"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }));
    await expect(postgresSql.query("SELECT 1")).rejects.toMatchObject({ code: "POSTGRES_STATE_FAILED", connectionCode: "SELF_SIGNED_CERT_IN_CHAIN", message: "POSTGRES_STATE_FAILED" });
    poolQuery.mockRejectedValue(Object.assign(new Error("private details"), { code: "arbitrary-private-value" }));
    await expect(postgresSql.query("SELECT 1")).rejects.toMatchObject({ connectionCode: undefined, message: "POSTGRES_STATE_FAILED" });
  });
  it("exposes commit uncertainty without claiming a definite business failure", async () => {
    const response = approvalErrorResponse(new PostgresStateError("POSTGRES_COMMIT_UNCERTAIN", "08006"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "POSTGRES_COMMIT_UNCERTAIN", executionStatus: "execution_unknown" });
  });
});