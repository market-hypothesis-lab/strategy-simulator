import { computeFeatureVector, normalizeYahooChart } from "./features.mjs";
import {
  delay,
  isTransientStatus,
  isTransientTransportError,
  retryAfterMilliseconds,
  retryBackoffMilliseconds,
} from "./retry.mjs";

export function yahooChartUrl(ticker) {
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", "2y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includeAdjustedClose", "true");
  return url;
}

export async function fetchYahooFeatureVector(ticker, {
  fetchImpl = globalThis.fetch,
  attempts = 3,
  retryDelay = delay,
  random = Math.random,
  clock = Date.now,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }

  const url = yahooChartUrl(ticker);
  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 (compatible; strategy-simulator-public-scan/1.0; +https://github.com/market-hypothesis-lab/strategy-simulator)",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const error = new Error(`Yahoo chart request failed with HTTP ${response.status}`);
        error.transient = isTransientStatus(response.status);
        error.retryAfterMs = retryAfterMilliseconds(response, clock);
        throw error;
      }
      const payload = await response.json();
      return computeFeatureVector(ticker, normalizeYahooChart(payload, ticker));
    } catch (error) {
      finalError = error;
      const transient = error?.transient === true || isTransientTransportError(error);
      if (!transient || attempt === attempts) {
        break;
      }
      await retryDelay(retryBackoffMilliseconds(attempt, {
        retryAfterMs: error?.retryAfterMs ?? 0,
        random,
      }));
    }
  }
  throw new Error("Yahoo chart retrieval or validation failed", { cause: finalError });
}
