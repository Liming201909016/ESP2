import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginCatalogResponseSchema, pluginTrialResponseSchema } from "../../../lib/esp/plugin-contracts";
import { KnowledgeVerificationError } from "../../../lib/esp/knowledge-grounding";
import { knowledgeVerificationReasonSchema } from "../../../lib/esp/contracts";

const { invokePlugin } = vi.hoisted(() => ({ invokePlugin: vi.fn() }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin: vi.fn(), finish: vi.fn() }, getAudit: vi.fn() }));
vi.mock("../../../lib/esp/plugin-execution", () => ({ invokePlugin }));

import { GET } from "./route";
import { POST } from "./[pluginId]/trial/route";

const context = (pluginId: string) => ({ params: Promise.resolve({ pluginId }) });
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/plugins/tickets/trial", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const createInput = { operationId: "tickets.create", skillId: "create-it-ticket", input: { query: "Create a simulated ticket", parameters: { description: "Simulated VPN failure", impact: "individual", device: "SIM-LT-0042" } } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ESP_ENVIRONMENT", "dev");
  vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true");
  vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read,tickets.read,tickets.create");
});
afterEach(() => vi.unstubAllEnvs());

describe("plugin catalog and trials", () => {
  it("lists contracts without invoking plugins", async () => {
    const response = await GET(new Request("http://localhost/api/plugins"));
    const body = pluginCatalogResponseSchema.parse(await response.json());
    expect(body.plugins).toHaveLength(2);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("only lists permitted operations, including an empty catalog for no permissions", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read");
    const body = await (await GET(new Request("http://localhost/api/plugins"))).json();
    expect(body.plugins[0].operations.map((operation: { id: string }) => operation.id)).toEqual(["tickets.get"]);
    expect(body.plugins).toHaveLength(1);
    vi.stubEnv("ESP_DEV_PERMISSIONS", "");
    expect((await (await GET(new Request("http://localhost/api/plugins"))).json()).plugins).toEqual([]);
  });

  it("rejects unauthenticated reads and trials", async () => {
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false");
    expect((await GET(new Request("http://localhost/api/plugins"))).status).toBe(401);
    expect((await POST(request(createInput), context("tickets"))).status).toBe(401);
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("previews complete write inputs without invoking the writer", async () => {
    const response = await POST(request(createInput), context("tickets"));
    const body = pluginTrialResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mode: "write_preview", status: "waiting_confirmation", execution: null, preview: { parameters: createInput.input.parameters, confirmed: false } });
    expect(body.trace.map((step) => step.step)).toContain("trial.write_not_executed");
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("returns missing fields for incomplete previews", async () => {
    const response = await POST(request({ ...createInput, input: { query: "Create ticket" } }), context("tickets"));
    expect(await response.json()).toMatchObject({ status: "needs_input", preview: null, execution: { type: "ticket_details_required", missingFields: ["description", "impact"] } });
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it.each([{ confirmed: true }, { createdBy: "another-user" }, { endpoint: "https://unregistered.example" }])("rejects extra execution controls: %j", async (extra) => {
    expect((await POST(request({ ...createInput, ...extra }), context("tickets"))).status).toBe(400);
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("enforces operation permissions and exact skill binding", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
    expect((await POST(request(createInput), context("tickets"))).status).toBe(403);
    vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read,tickets.create");
    expect((await POST(request({ ...createInput, skillId: "search-company-policy" }), context("tickets"))).status).toBe(400);
    expect((await POST(request(createInput), context("knowledge"))).status).toBe(404);
    expect((await POST(request(createInput), context("unknown"))).status).toBe(404);
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("passes only the server-resolved owner to real read operations", async () => {
    invokePlugin.mockResolvedValue({ type: "ticket_not_found", ticketId: "ESP-20260910-00000000" });
    const response = await POST(request({ operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "Ticket status", parameters: { ticketId: "esp-20260910-00000000" } } }), context("tickets"));
    const body = pluginTrialResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ mode: "live_read", status: "not_found", preview: null });
    expect(invokePlugin).toHaveBeenCalledWith("tickets.get", { skillId: "get-ticket-status", query: "Ticket status", parameters: { ticketId: "ESP-20260910-00000000" }, createdBy: "development:local" });
  });

  it("requires an owner for ticket trials even when a role is present", async () => {
    const principal = Buffer.from(JSON.stringify({ role_typ: "roles", claims: [{ typ: "roles", val: "tickets.create" }] })).toString("base64");
    expect((await POST(request(createInput, { "x-ms-client-principal": principal }), context("tickets"))).status).toBe(403);
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("retains no-evidence as a distinct read outcome", async () => {
    invokePlugin.mockResolvedValue({ type: "knowledge_not_found", corpus: "dev-samples" });
    const response = await POST(request({ operationId: "knowledge.answer", skillId: "search-company-policy", input: { query: "Unknown policy" } }), context("knowledge"));
    expect(pluginTrialResponseSchema.parse(await response.json())).toMatchObject({ status: "no_evidence", mode: "live_read", preview: null });
  });

  it("reports dependency failure with a request ID and trace, without retries or raw error data", async () => {
    invokePlugin.mockRejectedValue(new Error("private dependency detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(request({ operationId: "knowledge.answer", skillId: "search-company-policy", input: { query: "Leave policy" } }), context("knowledge"));
      const body = pluginTrialResponseSchema.parse(await response.json());
      expect(response.status).toBe(502);
      expect(body).toMatchObject({ status: "failed", error: "PLUGIN_EXECUTION_FAILED", execution: null });
      expect(body.trace.at(-1)?.step).toBe("plugin.failed");
      expect(JSON.stringify(body)).not.toContain("private dependency detail");
      expect(invokePlugin).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });

  it("validates request encoding, content type, size and operation fields before execution", async () => {
    expect((await POST(request(createInput, { "content-type": "text/plain" }), context("tickets"))).status).toBe(415);
    expect((await POST(request({ ...createInput, padding: "x".repeat(40_000) }), context("tickets"))).status).toBe(413);
    expect((await POST(request({ operationId: "tickets.get", skillId: "get-ticket-status", input: { query: "lookup", parameters: { ticketId: "invalid" } } }), context("tickets"))).status).toBe(400);
    expect((await POST(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0xc3, 0x28]) }), context("tickets"))).status).toBe(400);
    expect(invokePlugin).not.toHaveBeenCalled();
  });

  it("returns model throttling as a failed read with safe retry metadata", async () => {
    invokePlugin.mockRejectedValue(Object.assign(new Error("Private provider detail"), {
      status: 429, code: "rate_limit_exceeded", headers: new Headers({ "retry-after": "23" }),
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(request({ operationId: "knowledge.answer", skillId: "search-expense-policy", input: { query: "Hotel policy" } }), context("knowledge"));
      const body = pluginTrialResponseSchema.parse(await response.json());
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("23");
      expect(body).toMatchObject({ status: "failed", mode: "live_read", error: "MODEL_RATE_LIMITED", retryAfterSeconds: 23, execution: null });
      expect(body.trace.at(-1)?.step).toBe("plugin.rate_limited");
      expect(body.audit?.status).toBe("recorded");
      expect(JSON.stringify(body)).not.toContain("Private provider detail");
      expect(invokePlugin).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });

  it.each(knowledgeVerificationReasonSchema.options)("distinguishes %s verification failure from a plugin outage", async (reason) => {
    invokePlugin.mockRejectedValue(new KnowledgeVerificationError(reason, "Private rejected draft contents"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(request({ operationId: "knowledge.answer", skillId: "search-company-policy", input: { query: "Leave and attendance policy" } }), context("knowledge"));
      const body = pluginTrialResponseSchema.parse(await response.json());
      expect(response.status).toBe(502);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(body).toMatchObject({ status: "failed", mode: "live_read", error: "KNOWLEDGE_VERIFICATION_FAILED", verificationReason: reason, execution: null, preview: null });
      expect(body.trace.at(-1)?.step).toBe(`knowledge.verification.${reason}`);
      expect(body.audit?.status).toBe("recorded");
      expect(JSON.stringify(body) + JSON.stringify(log.mock.calls)).not.toContain("Private rejected draft");
      expect(invokePlugin).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});