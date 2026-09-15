import { beforeEach, describe, expect, it, vi } from "vitest";

const { dependencyReadiness } = vi.hoisted(() => ({ dependencyReadiness: vi.fn() }));
vi.mock("../../../lib/esp/readiness-probes", () => ({ dependencyReadiness }));
import { GET } from "./route";

beforeEach(() => vi.resetAllMocks());
describe("dependency readiness endpoint", () => {
  it.each([["ready", 200], ["degraded", 503]])("returns %s as HTTP %s without cacheable configuration", async (status, expected) => {
    dependencyReadiness.mockResolvedValue({ status, scope: "storage-search-state", model: "not_probed", checks: {} });
    const response = await GET();
    expect(response.status).toBe(expected); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ status, model: "not_probed" });
  });
});