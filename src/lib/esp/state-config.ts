import { z } from "zod";

type Environment = Readonly<Record<string, string | undefined>>;

export function stateBackend(environment: Environment = process.env): "blob" | "postgres" {
  const parsed = z.enum(["blob", "postgres"]).safeParse(environment.ESP_STATE_BACKEND ?? "blob");
  if (!parsed.success) throw new Error("INVALID_STATE_BACKEND");
  return parsed.data;
}

export function stateWritesPaused(environment: Environment = process.env) {
  return environment.ESP_STATE_WRITES_PAUSED === "true";
}

export class StateMaintenanceError extends Error {
  readonly code = "STATE_WRITES_PAUSED";
  constructor() { super("STATE_WRITES_PAUSED"); }
}

export function assertStateWritesAvailable() {
  if (stateWritesPaused()) throw new StateMaintenanceError();
}

export function postgresConnectionOptions(environment: Environment = process.env) {
  const parsed = z.object({
    host: z.string().trim().min(1).regex(/^[a-z0-9.-]+$/i),
    database: z.string().trim().min(1), user: z.string().trim().min(1),
    password: z.string().min(1).refine((value) => !value.startsWith("@Microsoft.KeyVault(")),
    port: z.coerce.number().int().min(1).max(65_535),
  }).safeParse({
    host: environment.POSTGRES_HOST, database: environment.POSTGRES_DATABASE, user: environment.POSTGRES_USER,
    password: environment.POSTGRES_PASSWORD, port: environment.POSTGRES_PORT ?? "5432",
  });
  if (!parsed.success) throw new Error(`POSTGRES_CONFIGURATION_INVALID:${[...new Set(parsed.error.issues.map((issue) => issue.path[0]))].join(",")}`);
  return {
    ...parsed.data,
    ssl: { rejectUnauthorized: true }, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000,
    statement_timeout: 15_000, application_name: "esp-platform-state",
  };
}