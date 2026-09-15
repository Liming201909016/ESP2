import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogResponseSchema } from "../../../lib/esp/catalog-contracts";
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false");
  vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read,tickets.read,tickets.create");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/skills", () => {
  it("returns a valid DEV catalog without contacting dependency services", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await GET(new Request("http://localhost/api/skills"));
    const body = catalogResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(body.skills).toHaveLength(7);
    expect(body.runtime?.identity).toEqual({ displayName: "Local developer", source: "development" });
    expect(body.runtime).not.toHaveProperty("subject");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.skills.filter((entry) => entry.confirmationRequired).map((entry) => entry.id)).toEqual(["create-it-ticket"]);
  });

  it("does not return the registry to an unauthenticated server request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(new Request("http://localhost/api/skills"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "AUTHENTICATION_REQUIRED" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reports only allowlisted environment metadata instead of inventing a region", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ESP_ENVIRONMENT", "test");
    const body = await (await GET(new Request("http://localhost/api/skills"))).json();
    expect(body.runtime.environment).toBe("test");
    expect(body.runtime).not.toHaveProperty("region");
    expect(body.runtime.identity).not.toHaveProperty("subject");
  });

  it("returns only the skills allowed to the current identity", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const principal = Buffer.from(JSON.stringify({ role_typ: "roles", claims: [{ typ: "roles", val: "tickets.read" }] })).toString("base64");
    const response = await GET(new Request("http://localhost/api/skills", { headers: { "x-ms-client-principal": principal } }));
    const body = catalogResponseSchema.parse(await response.json());
    expect(body.skills.map((skill) => skill.id)).toEqual(["get-ticket-status"]);
    expect(JSON.stringify(body)).not.toContain("search-company-policy");
  });

  it("shows an empty catalog rather than hidden definitions when no role is granted", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ESP_DEV_PERMISSIONS", "");
    const response = await GET(new Request("http://localhost/api/skills"));
    expect(response.status).toBe(200);
    expect((await response.json()).skills).toEqual([]);
  });
});