vi.mock("../../../lib/esp/audit-store", () => ({ auditWriter: { begin: vi.fn(), finish: vi.fn() }, getAudit: vi.fn() }));
import { afterEach, describe, expect, it, vi } from "vitest";

const { listTickets } = vi.hoisted(() => ({ listTickets: vi.fn() }));
vi.mock("../../../lib/esp/ticket-store", () => ({ listTickets }));

import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/tickets", () => {
  it("lists only tickets for the development subject", async () => {
    vi.stubEnv("NODE_ENV", "development");
    listTickets.mockResolvedValue([{ id: "ESP-1", status: "open" }]);

    const response = await GET(new Request("http://localhost/api/tickets"));

    expect(response.status).toBe(200);
    expect(listTickets).toHaveBeenCalledWith("development:local", 50);
  });

  it("rejects an unauthenticated production request", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await GET(new Request("http://localhost/api/tickets"));

    expect(response.status).toBe(401);
    expect(listTickets).not.toHaveBeenCalled();
  });
});