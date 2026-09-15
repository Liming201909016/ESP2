import { randomUUID } from "node:crypto";
import { skillParametersSchema, ticketDetailsSchema, type ExecutionResult, type SkillParameters } from "./contracts";
import { answerKnowledge } from "./knowledge";
import { pluginInputSchemas, pluginOutputSchemas } from "./plugin-contracts";
import { pluginOperations, type PluginOperationId } from "./plugin-registry";
import { getTicket, saveTicket, type TicketRecord } from "./ticket-store";
import { missingTicketFields, ticketIdsInQuery } from "./ticket-input";

export type PluginDependencies = {
  writeTicket: (ticket: TicketRecord) => Promise<void>;
  readTicket: (ticketId: string, createdBy: string) => Promise<TicketRecord | null>;
  answerKnowledge: typeof answerKnowledge;
  ticketMetadata?: Pick<TicketRecord, "id" | "createdAt" | "approvalId">;
};

export type PluginInvocation = {
  skillId: string;
  query: string;
  createdBy: string;
  parameters: SkillParameters;
};

type PluginHandler = (invocation: PluginInvocation, dependencies: PluginDependencies) => Promise<ExecutionResult>;

const handlers: Record<PluginOperationId, PluginHandler> = {
  "knowledge.answer": async ({ skillId, query }, dependencies) => dependencies.answerKnowledge(skillId, query),
  "tickets.get": async ({ query, createdBy, parameters }, dependencies) => {
    const ticketIds = parameters.ticketId ? [parameters.ticketId] : ticketIdsInQuery(query);
    if (ticketIds.length !== 1) return { type: "input_required", field: "ticketId" };
    const ticketId = ticketIds[0];
    const ticket = await dependencies.readTicket(ticketId, createdBy);
    return ticket ? { type: "ticket_status", ticket } : { type: "ticket_not_found", ticketId };
  },
  "tickets.create": async ({ parameters, createdBy }, dependencies) => {
    const missingFields = missingTicketFields(parameters);
    if (missingFields.length) return { type: "ticket_details_required", parameters, missingFields };
    const details = ticketDetailsSchema.parse({ description: parameters.description, device: parameters.device, impact: parameters.impact });
    const createdAt = dependencies.ticketMetadata?.createdAt ?? new Date().toISOString();
    const ticket: TicketRecord = {
      id: dependencies.ticketMetadata?.id ?? `ESP-${createdAt.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "open", summary: details.description, createdAt, createdBy, details,
      ...(dependencies.ticketMetadata?.approvalId ? { approvalId: dependencies.ticketMetadata.approvalId } : {}),
    };
    await dependencies.writeTicket(ticket);
    return { type: "ticket_created", ticket };
  },
};

export async function invokePlugin(
  operationId: PluginOperationId,
  invocation: PluginInvocation,
  dependencies: Partial<PluginDependencies> = {},
): Promise<ExecutionResult> {
  const operation = pluginOperations.find((entry) => entry.id === operationId);
  if (!operation?.skillIds.some((skillId) => skillId === invocation.skillId)) {
    return { type: "unavailable", skillId: invocation.skillId };
  }
  const parameters = invocation.parameters;
  const input = pluginInputSchemas[operation.id].parse(operation.kind === "knowledge" ? { query: invocation.query } : {
    query: invocation.query,
    parameters: operation.kind === "ticket_lookup" ? { ticketId: parameters.ticketId } : {
      description: parameters.description, device: parameters.device, impact: parameters.impact,
    },
  });
  const result = await handlers[operation.id]({ ...invocation, query: input.query, parameters: skillParametersSchema.parse("parameters" in input ? input.parameters : {}) }, {
    writeTicket: dependencies.writeTicket ?? saveTicket,
    readTicket: dependencies.readTicket ?? getTicket,
    answerKnowledge: dependencies.answerKnowledge ?? answerKnowledge,
    ticketMetadata: dependencies.ticketMetadata,
  });
  return pluginOutputSchemas[operation.id].parse(result);
}