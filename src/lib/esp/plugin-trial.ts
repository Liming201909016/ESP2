import { randomUUID } from "node:crypto";
import { skillParametersSchema, ticketDetailsSchema } from "./contracts";
import type { IdentityContext } from "./identity";
import { pluginInputSchemas, pluginOutputSchemas, pluginTrialRequestSchema, pluginTrialResponseSchema, type PluginTrialResponse } from "./plugin-contracts";
import { invokePlugin } from "./plugin-execution";
import { builtinPlugins, pluginOperations } from "./plugin-registry";
import { skillRegistry } from "./registry";
import { missingTicketFields } from "./ticket-input";
import { modelRateLimit } from "./model-rate-limit";
import { KnowledgeVerificationError } from "./knowledge-grounding";

export class PluginTrialError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export async function readPluginTrialJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new PluginTrialError("JSON_REQUIRED", 415);
  if (!request.body) throw new PluginTrialError("INVALID_REQUEST", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 32_768) { await reader.cancel(); throw new PluginTrialError("REQUEST_TOO_LARGE", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new PluginTrialError("INVALID_REQUEST", 400); }
}

export async function runPluginTrial(
  pluginId: string,
  body: unknown,
  identity: IdentityContext,
  invoke: typeof invokePlugin = invokePlugin,
  requestId: string = randomUUID(),
): Promise<PluginTrialResponse> {
  if (!identity.authenticated) throw new PluginTrialError("AUTHENTICATION_REQUIRED", 401);
  const request = pluginTrialRequestSchema.parse(body);
  const plugin = builtinPlugins.find((entry) => entry.id === pluginId);
  const operation = pluginOperations.find((entry) => entry.id === request.operationId && entry.pluginId === pluginId);
  if (!plugin || !operation) throw new PluginTrialError("PLUGIN_OPERATION_NOT_FOUND", 404);
  if (!operation.permissions.every((permission) => identity.permissions.includes(permission))) throw new PluginTrialError("PERMISSION_REQUIRED", 403);
  const skill = skillRegistry.find((entry) => entry.id === request.skillId && operation.skillIds.some((id) => id === entry.id));
  if (!skill) throw new PluginTrialError("OPERATION_SKILL_MISMATCH", 400);
  if (!skill.permissions.every((permission) => identity.permissions.includes(permission))) throw new PluginTrialError("PERMISSION_REQUIRED", 403);
  if (operation.pluginId === "tickets" && !identity.subject) throw new PluginTrialError("SUBJECT_REQUIRED", 403);
  const input = pluginInputSchemas[operation.id].parse(request.input);
  const parameters = skillParametersSchema.parse("parameters" in input ? input.parameters : {});
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const result: PluginTrialResponse = {
    requestId, pluginId: plugin.id, pluginVersion: plugin.version, operationId: operation.id, skillId: skill.id,
    mode: operation.effect === "write" ? "write_preview" : "live_read", status: "completed", startedAt, completedAt: startedAt, durationMs: 0,
    execution: null, preview: null,
    trace: ["plugin.resolved", "permissions.allowed", "input.validated"].map((step) => ({ step, at: startedAt })),
  };
  if (operation.effect === "write") {
    const missingFields = missingTicketFields(parameters);
    if (missingFields.length) {
      result.status = "needs_input";
      result.execution = { type: "ticket_details_required", parameters, missingFields };
    } else {
      result.status = "waiting_confirmation";
      result.preview = { selectedSkillId: "create-it-ticket", query: input.query, parameters: ticketDetailsSchema.parse(parameters), confirmed: false };
    }
    result.trace.push({ step: "trial.write_not_executed", at: new Date().toISOString() });
  } else {
    result.trace.push({ step: "plugin.execution_started", at: new Date().toISOString() });
    try {
      const execution = pluginOutputSchemas[operation.id].parse(await invoke(operation.id, {
        skillId: skill.id, query: input.query, parameters, createdBy: identity.subject ?? "unknown",
      }));
      result.execution = execution;
      result.status = execution.type === "knowledge_not_found" ? "no_evidence" : execution.type === "ticket_not_found" ? "not_found" : execution.type === "input_required" ? "needs_input" : "completed";
      result.trace.push({ step: `plugin.${result.status}`, at: new Date().toISOString() });
    } catch (error) {
      const limited = modelRateLimit(error);
      const verification = error instanceof KnowledgeVerificationError ? error.reason : null;
      console.error("plugin.trial.failed", {
        requestId: result.requestId, operationId: operation.id, name: error instanceof Error ? error.name : "UnknownError",
        ...(verification ? { code: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: verification } : {}),
      });
      result.status = "failed";
      result.error = verification ? "KNOWLEDGE_VERIFICATION_FAILED" : limited ? "MODEL_RATE_LIMITED" : "PLUGIN_EXECUTION_FAILED";
      if (verification) result.verificationReason = verification;
      if (limited) result.retryAfterSeconds = limited.retryAfterSeconds;
      result.trace.push({ step: verification ? `knowledge.verification.${verification}` : limited ? "plugin.rate_limited" : "plugin.failed", at: new Date().toISOString() });
    }
  }
  result.completedAt = new Date().toISOString();
  result.durationMs = Math.round(performance.now() - started);
  return pluginTrialResponseSchema.parse(result);
}