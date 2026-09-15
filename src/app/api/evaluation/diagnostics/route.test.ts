import { afterEach, describe, expect, it, vi } from "vitest";
const { diagnose, begin, finish } = vi.hoisted(() => ({ diagnose: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
vi.mock("../../../../lib/esp/simulation-diagnostics", async (original) => ({ ...await original<typeof import("../../../../lib/esp/simulation-diagnostics")>(), diagnoseSimulation: diagnose }));
vi.mock("../../../../lib/esp/audit-store", () => ({ auditWriter: { begin, finish }, getAudit: vi.fn() }));
import { POST } from "./route";
function request(body: unknown = { caseId: "VPN-001" }) { return new Request("http://localhost/api/evaluation/diagnostics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("simulation diagnostic access", () => {
  it("is disabled by default without model or audit calls", async () => {
    vi.stubEnv("ESP_SIMULATION_DIAGNOSTICS", "");
    expect((await POST(request())).status).toBe(404); expect(diagnose).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });
  it.each(["environment", "bypass", "permissions"])("rejects an incompatible %s", async (mode) => {
    vi.stubEnv("ESP_SIMULATION_DIAGNOSTICS", "true"); vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ESP_ENVIRONMENT", mode === "environment" ? "production" : "dev");
    vi.stubEnv("ESP_DEV_AUTH_BYPASS", mode === "bypass" ? "false" : "true");
    vi.stubEnv("ESP_DEV_PERMISSIONS", mode === "permissions" ? "tickets.read" : "knowledge.read");
    expect((await POST(request())).status).toBe(403); expect(diagnose).not.toHaveBeenCalled();
  });
  it("accepts only fixed-case controls and excludes diagnostic text from the audit", async () => {
    vi.stubEnv("ESP_SIMULATION_DIAGNOSTICS", "true"); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ESP_ENVIRONMENT", "dev"); vi.stubEnv("ESP_DEV_AUTH_BYPASS", "true"); vi.stubEnv("ESP_DEV_PERMISSIONS", "knowledge.read");
    expect((await POST(request({ caseId: "VPN-001", query: "arbitrary input" }))).status).toBe(400); expect(diagnose).not.toHaveBeenCalled();
    diagnose.mockResolvedValue({ caseId: "VPN-001", draft: { answer: "SIMULATED_REJECTED_DRAFT" }, error: "unsupported" });
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).diagnostic.draft.answer).toBe("SIMULATED_REJECTED_DRAFT");
    expect(JSON.stringify(begin.mock.calls) + JSON.stringify(finish.mock.calls)).not.toContain("SIMULATED_REJECTED_DRAFT");
  });
});