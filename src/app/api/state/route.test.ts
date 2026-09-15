import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postgresStateStatus } = vi.hoisted(() => ({ postgresStateStatus: vi.fn() }));
vi.mock("../../../lib/esp/state-status", () => ({ postgresStateStatus }));
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true");
  vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read,tickets.create"); vi.stubEnv("ESP_STATE_BACKEND", "blob"); vi.stubEnv("ESP_STATE_WRITES_PAUSED", "false");
  postgresStateStatus.mockResolvedValue({ reachable: true, prepared: false, schemaVersion: null, counts: null, lastMigration: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("GET /api/state", () => {
  it("reports the current backend without probing unused PostgreSQL", async () => {
    const response = await GET(new Request("http://localhost/api/state"));
    expect(await response.json()).toEqual({ backend: "blob", writesPaused: false, postgres: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(postgresStateStatus).not.toHaveBeenCalled();
  });
  it("allows explicit DEV target inspection before switching backend", async () => {
    const body = await (await GET(new Request("http://localhost/api/state?target=postgres"))).json();
    expect(body.backend).toBe("blob"); expect(body.postgres.reachable).toBe(true);
    expect(postgresStateStatus).toHaveBeenCalledWith("development:local");
  });
  it("does not query a database for unauthenticated or unpermitted callers", async () => {
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false"); expect((await GET(new Request("http://localhost/api/state"))).status).toBe(401);
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
    expect((await GET(new Request("http://localhost/api/state"))).status).toBe(403); expect(postgresStateStatus).not.toHaveBeenCalled();
  });
  it("rejects arbitrary target names", async () => {
    expect((await GET(new Request("http://localhost/api/state?target=other"))).status).toBe(400);
    expect(postgresStateStatus).not.toHaveBeenCalled();
  });
  it("does not expose credentials in configuration failures", async () => {
    postgresStateStatus.mockRejectedValue(new Error("POSTGRES_CONFIGURATION_INVALID:password")); vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(new Request("http://localhost/api/state?target=postgres"));
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "STATE_STATUS_UNAVAILABLE", configuration: ["password"] });
  });
});