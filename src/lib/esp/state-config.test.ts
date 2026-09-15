import { describe, expect, it } from "vitest";
import { postgresConnectionOptions, stateBackend, stateWritesPaused } from "./state-config";

const environment = { POSTGRES_HOST: "test.postgres.database.azure.com", POSTGRES_DATABASE: "esp", POSTGRES_USER: "test-user", POSTGRES_PASSWORD: "synthetic-test-password" };

describe("transaction state configuration", () => {
  it("keeps Blob as the default until an explicit cutover", () => {
    expect(stateBackend({})).toBe("blob");
    expect(stateBackend({ ESP_STATE_BACKEND: "postgres" })).toBe("postgres");
  });
  it("does not silently select another store for an unknown backend", () => {
    expect(() => stateBackend({ ESP_STATE_BACKEND: "unknown" })).toThrow("INVALID_STATE_BACKEND");
  });
  it("requires complete PostgreSQL settings and verified TLS", () => {
    expect(postgresConnectionOptions(environment)).toMatchObject({ ssl: { rejectUnauthorized: true }, port: 5432, max: 5, statement_timeout: 15_000 });
    expect(() => postgresConnectionOptions({})).toThrow("POSTGRES_CONFIGURATION_INVALID");
  });
  it("rejects unresolved secret references without revealing their value", () => {
    const secret = "@Microsoft.KeyVault(SecretUri=https://test.vault.azure.net/secrets/synthetic)";
    try { postgresConnectionOptions({ ...environment, POSTGRES_PASSWORD: secret }); throw new Error("Expected validation failure"); }
    catch (error) { expect((error as Error).message).toBe("POSTGRES_CONFIGURATION_INVALID:password"); expect((error as Error).message).not.toContain(secret); }
  });
  it("does not trim password data and bounds connection ports", () => {
    expect(postgresConnectionOptions({ ...environment, POSTGRES_PASSWORD: " test password " }).password).toBe(" test password ");
    expect(() => postgresConnectionOptions({ ...environment, POSTGRES_PORT: "0" })).toThrow("POSTGRES_CONFIGURATION_INVALID:port");
  });
  it("pauses state writes only through the explicit maintenance flag", () => {
    expect(stateWritesPaused({})).toBe(false);
    expect(stateWritesPaused({ ESP_STATE_WRITES_PAUSED: "true" })).toBe(true);
  });
});