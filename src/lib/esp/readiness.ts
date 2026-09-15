export type ProbeStatus = "healthy" | "unavailable" | "not_configured" | "not_required";
export type ProbeResult = { status: ProbeStatus; durationMs: number };
export type ReadinessResult = {
  status: "ready" | "degraded"; checkedAt: string; validUntil: string;
  scope: "storage-search-state"; model: "not_probed";
  checks: Record<"blob" | "search" | "state", ProbeResult>;
};
export type ReadinessProbes = Record<keyof ReadinessResult["checks"], () => Promise<ProbeStatus>>;

export function createReadinessCheck(probes: ReadinessProbes, options: { cacheMs?: number; timeoutMs?: number; now?: () => number } = {}) {
  const cacheMs = options.cacheMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? 25_000;
  const now = options.now ?? Date.now;
  let cached: ReadinessResult | undefined;
  let pending: Promise<ReadinessResult> | undefined;

  async function probe(check: () => Promise<ProbeStatus>): Promise<ProbeResult> {
    const started = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<ProbeStatus>((resolve) => { timer = setTimeout(() => resolve("unavailable"), timeoutMs); });
      const status = await Promise.race([Promise.resolve().then(check), deadline]);
      return { status, durationMs: Math.max(0, now() - started) };
    } catch {
      return { status: "unavailable", durationMs: Math.max(0, now() - started) };
    } finally {
      clearTimeout(timer);
    }
  }

  return async function readiness(): Promise<ReadinessResult> {
    if (cached && Date.parse(cached.validUntil) > now()) return structuredClone(cached);
    if (!pending) {
      pending = (async () => {
        const [blob, search, state] = await Promise.all([probe(probes.blob), probe(probes.search), probe(probes.state)]);
        const checks = { blob, search, state };
        const completedAt = now();
        const result: ReadinessResult = {
          status: Object.values(checks).every((check) => check.status === "healthy" || check.status === "not_required") ? "ready" : "degraded",
          scope: "storage-search-state", model: "not_probed", checkedAt: new Date(completedAt).toISOString(), validUntil: new Date(completedAt + cacheMs).toISOString(), checks,
        };
        cached = result;
        return result;
      })().finally(() => { pending = undefined; });
    }
    return structuredClone(await pending);
  };
}