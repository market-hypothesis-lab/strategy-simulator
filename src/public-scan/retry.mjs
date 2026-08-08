const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CAUSE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const MAX_DELAY_MS = 30_000;

export function isTransientStatus(status) {
  return TRANSIENT_STATUS_CODES.has(status);
}

export function isTransientTransportError(error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return true;
  const causeCode = error?.cause?.code;
  if (typeof causeCode === "string" && TRANSIENT_CAUSE_CODES.has(causeCode)) return true;
  return error instanceof TypeError && /^(fetch failed|terminated)$/iu.test(error.message);
}

export function retryAfterMilliseconds(response, now = Date.now) {
  const value = response?.headers?.get?.("Retry-After");
  if (typeof value !== "string" || value.trim() === "") return 0;
  if (/^\d+$/u.test(value.trim())) {
    return Math.min(MAX_DELAY_MS, Number(value.trim()) * 1_000);
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return 0;
  return Math.min(MAX_DELAY_MS, Math.max(0, instant - now()));
}

export function retryBackoffMilliseconds(attempt, {
  retryAfterMs = 0,
  random = Math.random,
} = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("attempt must be positive");
  const jitter = 0.75 + (Math.min(1, Math.max(0, random())) * 0.5);
  const exponential = Math.min(8_000, 1_000 * (2 ** (attempt - 1))) * jitter;
  return Math.min(MAX_DELAY_MS, Math.ceil(Math.max(exponential, retryAfterMs)));
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
