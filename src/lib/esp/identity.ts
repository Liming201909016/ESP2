import { z } from "zod";
import { permissionSchema, type Permission } from "./contracts";

const principalSchema = z.object({
  auth_typ: z.string().optional(),
  name_typ: z.string().optional(),
  role_typ: z.string().optional(),
  claims: z.array(
    z.object({
      typ: z.string(),
      val: z.string(),
    }),
  ),
});

export type IdentityContext = {
  authenticated: boolean;
  subject: string | null;
  displayName: string | null;
  permissions: Permission[];
  source: "entra" | "development" | "none";
};

function parsePermissions(values: string[]) {
  return values.flatMap((value) => {
    const parsed = permissionSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function developmentIdentity(): IdentityContext {
  const configured = process.env.ESP_DEV_PERMISSIONS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    authenticated: true,
    subject: "development:local",
    displayName: "Local developer",
    permissions: parsePermissions(
      configured ?? ["knowledge.read", "tickets.read", "tickets.create"],
    ),
    source: "development",
  };
}

function developmentBypassEnabled() {
  return (
    process.env.ESP_ENVIRONMENT === "dev" &&
    process.env.ESP_DEV_AUTH_BYPASS === "true"
  );
}

export function resolveIdentity(headers: Headers): IdentityContext {
  const encodedPrincipal = headers.get("x-ms-client-principal");

  if (!encodedPrincipal) {
    return process.env.NODE_ENV === "production" && !developmentBypassEnabled()
      ? { authenticated: false, subject: null, displayName: null, permissions: [], source: "none" }
      : developmentIdentity();
  }

  try {
    const principal = principalSchema.parse(
      JSON.parse(Buffer.from(encodedPrincipal, "base64").toString("utf8")),
    );
    const roleClaimType = principal.role_typ ?? "roles";
    const nameClaimType = principal.name_typ ?? "name";

    return {
      authenticated: true,
      subject:
        principal.claims.find((claim) => claim.typ === "oid")?.val ??
        principal.claims.find((claim) => claim.typ === "sub")?.val ??
        null,
      displayName:
        principal.claims.find((claim) => claim.typ === nameClaimType)?.val ??
        headers.get("x-ms-client-principal-name"),
      permissions: parsePermissions(
        principal.claims
          .filter(
            (claim) => claim.typ === roleClaimType || claim.typ === "roles",
          )
          .map((claim) => claim.val),
      ),
      source: "entra",
    };
  } catch {
    return { authenticated: false, subject: null, displayName: null, permissions: [], source: "none" };
  }
}