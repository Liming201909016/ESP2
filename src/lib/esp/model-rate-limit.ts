export function modelRateLimit(error: unknown, now = Date.now()): { retryAfterSeconds: number } | null {
  if (!(error instanceof Error) || !("status" in error) || error.status !== 429 ||
    (!("code" in error) || error.code !== "rate_limit_exceeded") && error.name !== "RateLimitError") return null;
  const headers = "headers" in error && error.headers instanceof Headers ? error.headers : null;
  const retryAfter = headers?.get("retry-after");
  const retryMilliseconds = headers?.get("retry-after-ms") ?? headers?.get("x-ms-retry-after-ms");
  let seconds = 60;
  if (retryAfter) {
    seconds = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - now) / 1_000;
  } else if (retryMilliseconds && /^\d+(?:\.\d+)?$/.test(retryMilliseconds)) {
    seconds = Number(retryMilliseconds) / 1_000;
  }
  return { retryAfterSeconds: Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400 ? Math.max(1, Math.ceil(seconds)) : 60 };
}