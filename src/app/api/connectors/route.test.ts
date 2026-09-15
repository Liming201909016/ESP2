import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../../../lib/esp/connector-source";

const { listConnectorSources, connectorDetails, syncConnectorSource, begin, finish } = vi.hoisted(() => ({ listConnectorSources: vi.fn(), connectorDetails: vi.fn(), syncConnectorSource: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
const { seedConnectorExamples } = vi.hoisted(() => ({ seedConnectorExamples: vi.fn() }));
vi.mock("../../../lib/esp/connector-sync", () => ({ listConnectorSources, connectorDetails, syncConnectorSource }));
vi.mock("../../../lib/esp/connector-blob", () => ({ seedConnectorExamples }));
vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin, finish }, getAudit: vi.fn() }));
import { GET, POST as seed } from "./route";
import { GET as detail, POST as sync } from "./blob-knowledge/[sourceId]/route";

const context = { params: Promise.resolve({ sourceId: "sim-transit" }) };
const requestBody = { action: "sync", manifestEtag: '"m1"', contentEtag: '"c1"', fingerprint: "a".repeat(64), stateEtag: null };
const documentId = `kb-${"b".repeat(32)}`;
function request(body: unknown, headers: Record<string, string> = {}) { return new Request("http://localhost/api/connectors/blob-knowledge/sim-transit", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
  listConnectorSources.mockResolvedValue({ sources: [], nextCursor: "next", canSync: true });
  connectorDetails.mockResolvedValue({ sourceId: "sim-transit", canSync: true });
  syncConnectorSource.mockResolvedValue({ executionStatus: "completed", sync: { outcome: "created", documentId }, detail: { sourceId: "sim-transit" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Blob connector APIs", () => {
  it("initializes only fixed examples after explicit DEV confirmation and durable audit", async () => {
    seedConnectorExamples.mockResolvedValue({ executionStatus: "completed", examples: [{ sourceId: "sim-transit", outcome: "created" }] });
    const response = await seed(request({ action: "seed_examples" }));
    expect(response.status).toBe(200); expect((await response.json()).audit.status).toBe("recorded"); expect(seedConnectorExamples).toHaveBeenCalledOnce();
    expect((await seed(request({ action: "seed_examples", overwrite: true }))).status).toBe(400);
    expect(seedConnectorExamples).toHaveBeenCalledOnce();
  });

  it("lists one bounded page without syncing any sources", async () => {
    const response = await GET(new Request("http://localhost/api/connectors?cursor=current"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(listConnectorSources).toHaveBeenCalledWith(true, "current"); expect(syncConnectorSource).not.toHaveBeenCalled();
  });
  it("keeps detail reads separate from import mutations", async () => {
    expect((await detail(new Request("http://localhost"), context)).status).toBe(200);
    expect(connectorDetails).toHaveBeenCalledWith("sim-transit", true); expect(syncConnectorSource).not.toHaveBeenCalled();
  });
  it("uses existing permission and explicit DEV management gates", async () => {
    vi.stubEnv("ESP_DEV_PERMISSIONS", "tickets.read");
    expect((await GET(new Request("http://localhost/api/connectors"))).status).toBe(403);
    expect((await sync(request(requestBody), context)).status).toBe(403);
    vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "false");
    expect((await sync(request(requestBody), context)).status).toBe(401);
    vi.stubEnv("NODE_ENV", "development"); expect((await sync(request(requestBody), context)).status).toBe(403);
    expect(syncConnectorSource).not.toHaveBeenCalled();
  });
  it("does not accept arbitrary paths, accounts, metadata or publish controls", async () => {
    for (const extra of [{ account: "other" }, { prefix: "tickets/" }, { content: "changed input" }, { confirmed: true }, { publish: true }]) {
      expect((await sync(request({ ...requestBody, ...extra }), context)).status).toBe(400);
    }
    expect((await sync(request(requestBody), { params: Promise.resolve({ sourceId: "../tickets" }) })).status).toBe(400);
    expect(syncConnectorSource).not.toHaveBeenCalled();
  });
  it("preserves source conflicts as conflicts", async () => {
    syncConnectorSource.mockRejectedValue(new ConnectorError("SOURCE_CHANGED", 409));
    const response = await sync(request(requestBody), context);
    expect(response.status).toBe(409); expect((await response.json()).error).toBe("SOURCE_CHANGED");
  });
  it("requires the durable audit start before importing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); begin.mockRejectedValue(new Error("Audit unavailable"));
    expect((await sync(request(requestBody), context)).status).toBe(503); expect(syncConnectorSource).not.toHaveBeenCalled();
  });
  it("records connector/source/document references without source text", async () => {
    const response = await sync(request(requestBody), context); const body = await response.json();
    expect(body.audit.status).toBe("recorded");
    expect(syncConnectorSource).toHaveBeenCalledWith("sim-transit", requestBody, "development:local");
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ references: expect.arrayContaining([{ type: "connector", id: "blob-knowledge", version: "0.1.0" }, { type: "connector_source", id: "sim-transit" }, { type: "document", id: documentId, version: "1" }]) }), "development:local");
  });
  it("retains sync error detail without returning a successful operation", async () => {
    syncConnectorSource.mockResolvedValue({ executionStatus: "failed", sync: { outcome: "failed", documentId, error: "SYNC_DRAFT_UNCONFIRMED" }, detail: { state: { status: "error" } } });
    const response = await sync(request(requestBody), context); expect(response.status).toBe(502);
    expect((await response.json()).detail.state.status).toBe("error");
  });
});