import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

type Environment = Readonly<Record<string, string | undefined>>;
type SecretLoader = (vault: string, name: string, version: string) => Promise<string | undefined>;

export class PostgresSecretError extends Error {
  constructor(public code: "POSTGRES_SECRET_REFERENCE_INVALID" | "POSTGRES_SECRET_UNAVAILABLE", public statusCode?: number) { super(code); }
}

const loadSecret: SecretLoader = async (vault, name, version) => {
  const client = new SecretClient(vault, new DefaultAzureCredential(), { retryOptions: { maxRetries: 2 } });
  return (await client.getSecret(name, { version, abortSignal: AbortSignal.timeout(20_000) })).value;
};

export async function postgresCredentials(environment: Environment = process.env, load: SecretLoader = loadSecret): Promise<Environment> {
  const reference = environment.POSTGRES_SECRET_URI ?? /^@Microsoft\.KeyVault\(SecretUri=([^;)]+)\)$/.exec(environment.POSTGRES_PASSWORD ?? "")?.[1];
  if (!reference) return environment;
  let vault: URL;
  let secret: URL;
  try {
    vault = new URL(environment.KEY_VAULT_URI ?? "");
    secret = new URL(reference);
    if (vault.protocol !== "https:" || secret.origin !== vault.origin || vault.username || vault.password || secret.username || secret.password || secret.search || secret.hash || secret.port) throw new Error("Invalid reference");
  } catch { throw new PostgresSecretError("POSTGRES_SECRET_REFERENCE_INVALID"); }
  const path = /^\/secrets\/([a-zA-Z0-9-]{1,127})\/([a-fA-F0-9]{32})$/.exec(secret.pathname);
  if (!path) throw new PostgresSecretError("POSTGRES_SECRET_REFERENCE_INVALID");
  try {
    const password = await load(vault.origin, path[1], path[2]);
    if (!password || password.startsWith("@Microsoft.KeyVault(")) throw new Error("Invalid secret value");
    return { ...environment, POSTGRES_PASSWORD: password };
  } catch (error) {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
    throw new PostgresSecretError("POSTGRES_SECRET_UNAVAILABLE", statusCode);
  }
}