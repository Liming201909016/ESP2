import { describe, expect, it, vi } from "vitest";
import { pluginCatalogResponseSchema, pluginInputSchemas } from "./plugin-contracts";
import { getPluginCatalog } from "./plugin-catalog";
import { invokePlugin } from "./plugin-execution";

describe("built-in plugin contracts", () => {
  it("reports configured secret-reference dependencies without their values", () => {
    const catalog = getPluginCatalog(["tickets.read"], { ESP_STATE_BACKEND: "postgres", POSTGRES_HOST: "test", POSTGRES_DATABASE: "esp", POSTGRES_USER: "test", POSTGRES_SECRET_URI: "private-secret-uri", KEY_VAULT_URI: "private-vault-uri", AZURE_STORAGE_ACCOUNT: "test" });
    const postgres = catalog[0].dependencies.find((dependency) => dependency.id === "postgres")!;
    expect(postgres.configured).toBe(true);
    expect(postgres.requiredSettings.map((setting) => setting.name)).toContain("POSTGRES_SECRET_URI");
    expect(JSON.stringify(catalog)).not.toMatch(/private-secret-uri|private-vault-uri/);
  });

  it("reports PostgreSQL state and retained Blob audit dependencies after cutover", () => {
    const plugins = getPluginCatalog(["tickets.read"], { ESP_STATE_BACKEND: "postgres", POSTGRES_HOST: "test-host", POSTGRES_DATABASE: "esp", POSTGRES_USER: "test-user", POSTGRES_PASSWORD: "synthetic-private-value", AZURE_STORAGE_ACCOUNT: "testaccount" });
    expect(plugins[0].dependencies.map((dependency) => dependency.id)).toEqual(["postgres", "blob"]);
    expect(plugins[0].dependencies.every((dependency) => dependency.configured)).toBe(true);
    expect(JSON.stringify(plugins)).not.toContain("synthetic-private-value");
  });

  it("exposes two plugins and three operations from the execution registry", () => {
    const plugins = getPluginCatalog(["knowledge.read", "tickets.read", "tickets.create"], {});
    const catalog = pluginCatalogResponseSchema.parse({ plugins, generatedAt: new Date().toISOString() });
    expect(catalog.plugins.map((plugin) => plugin.id)).toEqual(["knowledge", "tickets"]);
    expect(plugins.flatMap((plugin) => plugin.operations.map((operation) => operation.id))).toEqual(["knowledge.answer", "tickets.get", "tickets.create"]);
    expect(plugins.flatMap((plugin) => plugin.operations.flatMap((operation) => operation.skills))).toHaveLength(7);
    for (const plugin of plugins) for (const operation of plugin.operations) {
      expect(operation.inputSchema.additionalProperties).toBe(false);
      for (const example of operation.examples) expect(pluginInputSchemas[operation.id].safeParse(example.input).success).toBe(true);
    }
  });

  it("filters plugin operations, bound skills and examples by existing permissions", () => {
    const plugins = getPluginCatalog(["tickets.read"], {});
    expect(plugins).toHaveLength(1);
    expect(plugins[0].operations.map((operation) => operation.id)).toEqual(["tickets.get"]);
    expect(JSON.stringify(plugins)).not.toContain("create-it-ticket");
    expect(getPluginCatalog([], {})).toEqual([]);
  });

  it("reports configuration presence without revealing values or claiming live health", () => {
    const catalog = getPluginCatalog(["knowledge.read"], { AZURE_SEARCH_ENDPOINT: "private-test-value", AZURE_AI_ENDPOINT: "private-test-value", AZURE_AI_CHAT_DEPLOYMENT: "private-test-value" });
    expect(catalog[0].dependencies.map((dependency) => dependency.configured)).toEqual([true, true, false]);
    expect(catalog[0].dependencies.every((dependency) => dependency.health === "not_checked")).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain("private-test-value");
  });

  it("rejects a dependency result that violates its registered output schema", async () => {
    const answerKnowledge = vi.fn().mockResolvedValue({ type: "knowledge_answer", corpus: "dev-samples", answer: "Unsupported answer", citations: [] });
    await expect(invokePlugin("knowledge.answer", { skillId: "search-company-policy", query: "leave policy", parameters: {}, createdBy: "test-user" }, { answerKnowledge })).rejects.toThrow();
  });

  it("rejects invalid inputs before contacting dependencies", async () => {
    const readTicket = vi.fn();
    await expect(invokePlugin("tickets.get", { skillId: "get-ticket-status", query: "lookup", parameters: { ticketId: "bad-id" }, createdBy: "test-user" }, { readTicket })).rejects.toThrow();
    expect(readTicket).not.toHaveBeenCalled();
  });

  it("does not retry a failing ticket write", async () => {
    const failure = new Error("Storage unavailable");
    const writeTicket = vi.fn().mockRejectedValue(failure);
    await expect(invokePlugin("tickets.create", { skillId: "create-it-ticket", query: "create ticket", parameters: { description: "Simulated network failure", impact: "individual" }, createdBy: "test-user" }, { writeTicket })).rejects.toBe(failure);
    expect(writeTicket).toHaveBeenCalledTimes(1);
  });
});