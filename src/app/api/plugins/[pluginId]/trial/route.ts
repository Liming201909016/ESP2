import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auditedResponse } from "../../../../../lib/esp/audit-http";
import { auditInput } from "../../../../../lib/esp/audit-operation";
import { pluginInputSchemas, pluginTrialRequestSchema } from "../../../../../lib/esp/plugin-contracts";
import { builtinPlugins, pluginOperations } from "../../../../../lib/esp/plugin-registry";
import { resolveIdentity } from "../../../../../lib/esp/identity";
import { PluginTrialError, readPluginTrialJson, runPluginTrial } from "../../../../../lib/esp/plugin-trial";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ pluginId: string }> }) {
  const identity = resolveIdentity(request.headers);
  const { pluginId } = await context.params;
  let body: unknown;
  let bodyError: unknown;
  try { body = await readPluginTrialJson(request); } catch (error) { bodyError = error; }
  const parsed = pluginTrialRequestSchema.safeParse(body);
  const operation = parsed.success ? pluginOperations.find((entry) => entry.id === parsed.data.operationId && entry.pluginId === pluginId) : undefined;
  const plugin = builtinPlugins.find((entry) => entry.id === pluginId);
  const input = parsed.success ? pluginInputSchemas[parsed.data.operationId].safeParse(parsed.data.input) : null;
  return auditedResponse(request, {
    identity, kind: "plugin_trial", action: operation ? `trial.${operation.id}` : "trial.invalid", mutation: false,
    input: input?.success ? auditInput({ query: input.data.query, parameters: "parameters" in input.data ? input.data.parameters as Record<string, unknown> : {} }) : { fields: [] },
    requiredPermissions: operation ? [...operation.permissions] : [], references: plugin ? [{ type: "plugin", id: plugin.id, version: plugin.version }] : [],
  }, async ({ requestId }) => {
    if (!identity.authenticated) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  try {
    if (bodyError) throw bodyError;
    const result = await runPluginTrial(pluginId, body, identity, undefined, requestId);
    return NextResponse.json(result, {
      status: result.error === "MODEL_RATE_LIMITED" ? 429 : result.status === "failed" ? 502 : 200,
      headers: { ...headers, ...(result.error === "MODEL_RATE_LIMITED" ? { "Retry-After": String(result.retryAfterSeconds ?? 60) } : {}) },
    });
  } catch (error) {
    if (error instanceof PluginTrialError) return NextResponse.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_REQUEST", details: error.flatten() }, { status: 400, headers });
    console.error("plugin.trial.request_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "PLUGIN_TRIAL_UNAVAILABLE" }, { status: 502, headers });
  }
  });
}