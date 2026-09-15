import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadinessCheck, type ReadinessProbes } from "./readiness";

afterEach(() => vi.useRealTimers());
const healthy = (): ReadinessProbes => ({ blob: vi.fn().mockResolvedValue("healthy"), search: vi.fn().mockResolvedValue("healthy"), state: vi.fn().mockResolvedValue("healthy") });

describe("bounded dependency readiness", () => {
  it("reports only safe statuses and explicitly excludes model execution", async () => {
    const result = await createReadinessCheck(healthy())();
    expect(result).toMatchObject({ status: "ready", scope: "storage-search-state", model: "not_probed", checks: { blob: { status: "healthy" }, search: { status: "healthy" }, state: { status: "healthy" } } });
    expect(Date.parse(result.validUntil) - Date.parse(result.checkedAt)).toBe(60_000);
  });
  it("coalesces simultaneous requests and caches both successful and failed results", async () => {
    vi.useFakeTimers(); const probes = healthy(); probes.search = vi.fn().mockRejectedValue(new Error("private endpoint and credential"));
    const check = createReadinessCheck(probes);
    const [first, second] = await Promise.all([check(), check()]);
    expect(first).toEqual(second); expect(first.status).toBe("degraded"); expect(probes.search).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toMatch(/private endpoint|credential/);
    first.checks.search.status = "healthy";
    expect((await check()).checks.search.status).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(60_000); await check(); expect(probes.search).toHaveBeenCalledTimes(2);
  });
  it("does not claim ready for unconfigured required services", async () => {
    const probes = healthy(); probes.blob = vi.fn().mockResolvedValue("not_configured"); probes.state = vi.fn().mockResolvedValue("not_required");
    const result = await createReadinessCheck(probes)();
    expect(result.status).toBe("degraded"); expect(result.checks.state.status).toBe("not_required");
  });
  it("treats the non-selected SQL backend as not required", async () => {
    const probes = healthy(); probes.state = vi.fn().mockResolvedValue("not_required");
    expect((await createReadinessCheck(probes)()).status).toBe("ready");
  });
  it("bounds a stalled dependency and does not retry it during the cache interval", async () => {
    vi.useFakeTimers(); const probes = healthy(); probes.blob = vi.fn(() => new Promise<never>(() => undefined));
    const check = createReadinessCheck(probes, { timeoutMs: 100 });
    const pending = check(); await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ status: "degraded", checks: { blob: { status: "unavailable", durationMs: 100 } } });
    await check(); expect(probes.blob).toHaveBeenCalledTimes(1);
  });
});