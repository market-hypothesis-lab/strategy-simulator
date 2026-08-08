import { createSignedHeaders } from "./auth.mjs";
import {
  delay,
  isTransientStatus,
  isTransientTransportError,
  retryAfterMilliseconds,
  retryBackoffMilliseconds,
} from "./retry.mjs";
import { fetchYahooFeatureVector } from "./yahoo.mjs";

export const CONFIG_PATH = "/internal/public-scan/v1/config";
export const INGEST_PATH = "/internal/public-scan/v1";
export const SCHEMA_VERSION = "public-scan.v1";
export const SOURCE_ID = "market-hypothesis-lab/strategy-simulator";
export const FEATURE_SCHEMA_VERSION = "technical-features.v1";

const TICKER_PATTERN = /^[A-Z0-9^.=\-]{1,24}$/;
const JP_SECURITY_CODE_PATTERN = /^[0-9][0-9A-Z]{3}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONFIG_KEYS = new Set(["schemaVersion", "universeVersion", "market", "timeZone", "tickers"]);

export function toYahooTicker(ticker) {
  return JP_SECURITY_CODE_PATTERN.test(ticker) ? `${ticker}.T` : ticker;
}

function validateBaseUrl(rawBaseUrl) {
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.length === 0) {
    throw new TypeError("PUBLIC_SCAN_BASE_URL is required");
  }
  const url = new URL(rawBaseUrl);
  const localTestUrl = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localTestUrl)) {
    throw new TypeError("PUBLIC_SCAN_BASE_URL must use HTTPS");
  }
  if (
    url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new TypeError("PUBLIC_SCAN_BASE_URL must be a clean origin without credentials or URL suffixes");
  }
  return url.origin;
}

function apiUrl(baseUrl, path) {
  return new URL(path, `${baseUrl}/`);
}

function requestTimestamp(now) {
  const milliseconds = now().getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("clock returned an invalid date");
  }
  return String(Math.floor(milliseconds / 1000));
}

function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("public scan config must be an object");
  }
  const keys = Object.keys(value);
  if (keys.length !== CONFIG_KEYS.size || keys.some((key) => !CONFIG_KEYS.has(key))) {
    throw new TypeError("public scan config has unexpected or missing fields");
  }
  if (value.schemaVersion !== "public-scan-config.v1") {
    throw new TypeError("unsupported public scan config schemaVersion");
  }
  if (typeof value.universeVersion !== "string" || !VERSION_PATTERN.test(value.universeVersion)) {
    throw new TypeError("public scan config requires a valid universeVersion");
  }
  if (value.market !== "JP" || value.timeZone !== "Asia/Tokyo") {
    throw new TypeError("public scan config must target JP in Asia/Tokyo");
  }
  if (!Array.isArray(value.tickers) || value.tickers.length === 0 || value.tickers.length > 400) {
    throw new TypeError("public scan config requires between 1 and 400 tickers");
  }

  const tickers = value.tickers.map((ticker) => {
    if (typeof ticker !== "string") {
      throw new TypeError("each ticker must be a string");
    }
    const normalized = ticker.trim().toUpperCase();
    if (!TICKER_PATTERN.test(normalized)) {
      throw new TypeError("config contained an invalid ticker");
    }
    return normalized;
  });
  if (new Set(tickers).size !== tickers.length) {
    throw new TypeError("config tickers must be unique");
  }

  return {
    schemaVersion: value.schemaVersion,
    universeVersion: value.universeVersion,
    market: value.market,
    timeZone: value.timeZone,
    tickers,
  };
}

async function parseSuccessfulJson(response, operation) {
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${operation} returned invalid JSON`, { cause: error });
  }
}

export async function getPublicScanConfig({
  baseUrl,
  secret,
  fetchImpl,
  now,
  attempts = 3,
  retryDelay = delay,
  random = Math.random,
}) {
  let previousTimestamp = 0;
  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timestamp = String(Math.max(Number(requestTimestamp(now)), previousTimestamp + 1));
    previousTimestamp = Number(timestamp);
    const headers = createSignedHeaders({ secret, method: "GET", path: CONFIG_PATH, timestamp, rawBody: "" });
    let response;
    try {
      response = await fetchImpl(apiUrl(baseUrl, CONFIG_PATH), {
        method: "GET",
        headers: { accept: "application/json", ...headers },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      finalError = error;
      if (!isTransientTransportError(error) || attempt === attempts) break;
      await retryDelay(retryBackoffMilliseconds(attempt, { random }));
      continue;
    }
    if (response.ok) {
      return validateConfig(await parseSuccessfulJson(response, "public scan config request"));
    }
    finalError = new Error(`public scan config request failed with HTTP ${response.status}`);
    if (!isTransientStatus(response.status) || attempt === attempts) break;
    await retryDelay(retryBackoffMilliseconds(attempt, {
      retryAfterMs: retryAfterMilliseconds(response),
      random,
    }));
  }
  throw new Error("public scan config request failed after bounded retries", { cause: finalError });
}

export async function postPublicScan({
  baseUrl,
  secret,
  payload,
  fetchImpl,
  now,
  attempts = 3,
  retryDelay = delay,
  random = Math.random,
}) {
  const rawBody = JSON.stringify(payload);
  let previousTimestamp = 0;
  let finalError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timestamp = String(Math.max(Number(requestTimestamp(now)), previousTimestamp + 1));
    previousTimestamp = Number(timestamp);
    const headers = createSignedHeaders({ secret, method: "POST", path: INGEST_PATH, timestamp, rawBody });
    let response;
    try {
      response = await fetchImpl(apiUrl(baseUrl, INGEST_PATH), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", ...headers },
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      finalError = error;
      if (!isTransientTransportError(error) || attempt === attempts) break;
      await retryDelay(retryBackoffMilliseconds(attempt, { random }));
      continue;
    }
    if (response.ok) return;
    finalError = new Error(`public scan ingest request failed with HTTP ${response.status}`);
    if (!isTransientStatus(response.status) || attempt === attempts) break;
    await retryDelay(retryBackoffMilliseconds(attempt, {
      retryAfterMs: retryAfterMilliseconds(response),
      random,
    }));
  }
  throw new Error("public scan ingest failed after bounded retries", { cause: finalError });
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function calendarDate(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function deriveMarketDate(records, timeZone) {
  const dates = records.map((record) => {
    const timestamp = Date.parse(record.observedAt);
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("records contained an invalid observedAt value");
    }
    return calendarDate(timestamp, timeZone);
  });
  const marketDate = [...dates].sort().at(-1);
  const latestCount = dates.filter((date) => date === marketDate).length;
  if (latestCount < Math.ceil(dates.length * 0.8)) {
    throw new TypeError("at least 80% of records must represent the latest market date");
  }
  const marketTime = Date.parse(`${marketDate}T00:00:00.000Z`);
  for (const date of dates) {
    const ageDays = (marketTime - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000;
    if (ageDays < 0 || ageDays > 14) {
      throw new TypeError("record dates must not be future-dated or more than 14 days stale");
    }
  }
  return marketDate;
}

export async function runPublicMarketScan({
  baseUrl: rawBaseUrl,
  secret,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  logger = console,
  concurrency = 4,
} = {}) {
  const baseUrl = validateBaseUrl(rawBaseUrl);
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("PUBLIC_SCAN_HMAC_SECRET must contain at least 32 characters");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new RangeError("concurrency must be an integer from 1 through 8");
  }

  const config = await getPublicScanConfig({ baseUrl, secret, fetchImpl, now });
  logger.info(`Public scan config accepted (${config.tickers.length} ticker(s)).`);

  let records;
  try {
    records = await mapWithConcurrency(
      config.tickers,
      concurrency,
      async (ticker) => ({
        ...await fetchYahooFeatureVector(toYahooTicker(ticker), { fetchImpl }),
        ticker,
      }),
    );
  } catch (error) {
    throw new Error("Public scan aborted because one or more ticker computations failed", { cause: error });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE_ID,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    universeVersion: config.universeVersion,
    marketDate: deriveMarketDate(records, config.timeZone),
    generatedAt: now().toISOString(),
    records,
  };
  await postPublicScan({ baseUrl, secret, payload, fetchImpl, now });
  logger.info(`Public scan published (${records.length} record(s), market date ${payload.marketDate}).`);

  return {
    universeVersion: config.universeVersion,
    marketDate: payload.marketDate,
    recordCount: records.length,
  };
}
