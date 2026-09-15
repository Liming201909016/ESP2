import { describe, expect, it, vi } from "vitest";
const { getSecret, secretOptions } = vi.hoisted(() => ({ getSecret: vi.fn(), secretOptions: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/keyvault-secrets", () => ({ SecretClient: class {
  constructor(_vault: string, _credential: unknown, options: unknown) { secretOptions(options); }
  getSecret = getSecret;
} }));
import { postgresCredentials } from "./postgres-secret";

const vault = "https://test-vault.vault.azure.net";
const version = "a".repeat(32);
const reference = `${vault}/secrets/postgres-admin-password/${version}`;

describe("versioned PostgreSQL secret resolution", () => {
  it("bounds cold-start secret reads with SDK retries and an abort signal", async () => {
    getSecret.mockResolvedValueOnce({ value: "synthetic-credential" });
    const environment = await postgresCredentials({ KEY_VAULT_URI: vault, POSTGRES_SECRET_URI: reference });
    expect(environment.POSTGRES_PASSWORD).toBe("synthetic-credential");
    expect(secretOptions).toHaveBeenCalledWith({ retryOptions: { maxRetries: 2 } });
    expect(getSecret).toHaveBeenCalledWith("postgres-admin-password", { version, abortSignal: expect.any(AbortSignal) });
  });
  it("keeps an already supplied password without contacting Key Vault", async () => {
    const load = vi.fn(); const environment = { POSTGRES_PASSWORD: "synthetic credential" };
    expect(await postgresCredentials(environment, load)).toBe(environment); expect(load).not.toHaveBeenCalled();
  });
  it("resolves only the configured vault and pinned secret version", async () => {
    const load = vi.fn(async () => " resolved synthetic credential ");
    const environment = await postgresCredentials({ KEY_VAULT_URI: `${vault}/`, POSTGRES_SECRET_URI: reference }, load);
    expect(load).toHaveBeenCalledWith(vault, "postgres-admin-password", version);
    expect(environment.POSTGRES_PASSWORD).toBe(" resolved synthetic credential ");
  });
  it("can resolve the existing App Service reference without changing it", async () => {
    const environment = await postgresCredentials({ KEY_VAULT_URI: vault, POSTGRES_PASSWORD: `@Microsoft.KeyVault(SecretUri=${reference})` }, async () => "synthetic credential");
    expect(environment.POSTGRES_PASSWORD).toBe("synthetic credential");
  });
  it.each([`${vault}/secrets/postgres-admin-password`, `https://another.vault.azure.net/secrets/db/${version}`, `http://test-vault.vault.azure.net/secrets/db/${version}`, `${reference}?alternate=true`])("rejects an untrusted or unversioned reference", async (uri) => {
    const load = vi.fn();
    await expect(postgresCredentials({ KEY_VAULT_URI: vault, POSTGRES_SECRET_URI: uri }, load)).rejects.toThrow("POSTGRES_SECRET_REFERENCE_INVALID");
    expect(load).not.toHaveBeenCalled();
  });
  it("does not expose secret values or raw dependency errors", async () => {
    const failure = Object.assign(new Error("private server response and secret"), { statusCode: 403 });
    await expect(postgresCredentials({ KEY_VAULT_URI: vault, POSTGRES_SECRET_URI: reference }, async () => { throw failure; })).rejects.toMatchObject({ message: "POSTGRES_SECRET_UNAVAILABLE", statusCode: 403 });
    await expect(postgresCredentials({ KEY_VAULT_URI: vault, POSTGRES_SECRET_URI: reference }, async () => "@Microsoft.KeyVault(invalid)")).rejects.toThrow("POSTGRES_SECRET_UNAVAILABLE");
  });
});