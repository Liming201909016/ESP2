import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIdentity } from "./identity";

afterEach(() => vi.unstubAllEnvs());

describe("resolveIdentity", () => {
  it("rejects an anonymous production request", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(resolveIdentity(new Headers())).toEqual({
      authenticated: false,
      subject: null,
      displayName: null,
      permissions: [],
      source: "none",
    });
  });

  it("allows an explicit bypass only in the dev environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ESP_ENVIRONMENT", "dev");
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read,tickets.read");

    expect(resolveIdentity(new Headers())).toMatchObject({
      authenticated: true,
      subject: "development:local",
      permissions: ["knowledge.read", "tickets.read"],
      source: "development",
    });

    vi.stubEnv("ESP_ENVIRONMENT", "production");

    expect(resolveIdentity(new Headers())).toMatchObject({
      authenticated: false,
      subject: null,
      permissions: [],
      source: "none",
    });
  });

  it("accepts only known Entra app roles", () => {
    vi.stubEnv("NODE_ENV", "production");
    const principal = Buffer.from(
      JSON.stringify({
        name_typ: "name",
        role_typ: "roles",
        claims: [
          { typ: "name", val: "ESP Developer" },
          { typ: "roles", val: "knowledge.read" },
          { typ: "roles", val: "owner" },
        ],
      }),
    ).toString("base64");

    const identity = resolveIdentity(
      new Headers({ "x-ms-client-principal": principal }),
    );

    expect(identity).toMatchObject({
      authenticated: true,
      displayName: "ESP Developer",
      permissions: ["knowledge.read"],
      source: "entra",
    });
  });
});