import assert from "node:assert/strict";
import test from "node:test";

import { createSignature } from "../src/public-scan/auth.mjs";
import {
  CONFIG_PATH,
  FEATURE_SCHEMA_VERSION,
  getPublicScanConfig,
  INGEST_PATH,
  SCHEMA_VERSION,
  SOURCE_ID,
  deriveMarketDate,
  postPublicScan,
  runPublicMarketScan,
  toYahooTicker,
} from "../src/public-scan/client.mjs";
import { makeYahooChartFixture } from "./fixtures/yahoo-chart.fixture.mjs";

const BASE_URL = "https://scan.example.test";
const SECRET = "fixture-secret-0123456789-abcdef-0123456789";
const FIXED_NOW = new Date("2026-08-08T13:00:00.000Z");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(payload);
    },
  };
}

function assertSignedRequest(options, path, rawBody = "") {
  const timestamp = options.headers["x-public-scan-timestamp"];
  const expected = createSignature(SECRET, {
    method: options.method,
    path,
    timestamp,
    rawBody,
  });
  assert.equal(options.headers["x-public-scan-signature"], `sha256=${expected}`);
}

test("JP security codes gain a Yahoo suffix while explicit symbols pass through", () => {
  assert.equal(toYahooTicker("1301"), "1301.T");
  assert.equal(toYahooTicker("285A"), "285A.T");
  assert.equal(toYahooTicker("1301.T"), "1301.T");
  assert.equal(toYahooTicker("^N225"), "^N225");
  assert.equal(toYahooTicker("GC=F"), "GC=F");
});

test("market-date coverage accepts exactly 80% and rejects one record below the boundary", () => {
  const current = { observedAt: "2026-08-07T06:00:00.000Z" };
  const stale = { observedAt: "2026-07-24T06:00:00.000Z" };
  const accepted = [...Array(180).fill(current), ...Array(45).fill(stale)];
  const rejected = [...Array(179).fill(current), ...Array(46).fill(stale)];

  assert.equal(deriveMarketDate(accepted, "Asia/Tokyo"), "2026-08-07");
  assert.throws(
    () => deriveMarketDate(rejected, "Asia/Tokyo"),
    /at least 80%/,
  );

  const tooStale = [...Array(224).fill(current), { observedAt: "2026-07-23T06:00:00.000Z" }];
  assert.throws(
    () => deriveMarketDate(tooStale, "Asia/Tokyo"),
    /more than 14 days stale/,
  );
});

test("scan signs config and result requests, computes transiently, and keeps internal tickers", async () => {
  const calls = [];
  let postedPayload;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.origin === BASE_URL && url.pathname === CONFIG_PATH) {
      assert.equal(options.body, undefined);
      assertSignedRequest(options, CONFIG_PATH, "");
      return jsonResponse({
        schemaVersion: "public-scan-config.v1",
        universeVersion: "jp-test-v1",
        market: "JP",
        timeZone: "Asia/Tokyo",
        tickers: ["7203"],
      });
    }
    if (url.hostname === "query2.finance.yahoo.com") {
      assert.match(url.pathname, /\/7203\.T$/);
      assert.equal(url.searchParams.get("range"), "2y");
      assert.equal(url.searchParams.get("events"), "div,splits");
      assert.match(options.headers["user-agent"], /strategy-simulator-public-scan/);
      return jsonResponse(makeYahooChartFixture("7203.T"));
    }
    if (url.origin === BASE_URL && url.pathname === INGEST_PATH) {
      assertSignedRequest(options, INGEST_PATH, options.body);
      postedPayload = JSON.parse(options.body);
      return jsonResponse({ accepted: true }, 202);
    }
    throw new Error("unexpected mocked URL");
  };
  const logs = [];

  const summary = await runPublicMarketScan({
    baseUrl: BASE_URL,
    secret: SECRET,
    fetchImpl,
    now: () => new Date(FIXED_NOW),
    logger: { info: (message) => logs.push(message) },
    concurrency: 2,
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(summary, {
    universeVersion: "jp-test-v1",
    marketDate: postedPayload.marketDate,
    recordCount: 1,
  });
  assert.equal(postedPayload.schemaVersion, SCHEMA_VERSION);
  assert.equal(postedPayload.source, SOURCE_ID);
  assert.equal(postedPayload.featureSchemaVersion, FEATURE_SCHEMA_VERSION);
  assert.equal(postedPayload.universeVersion, "jp-test-v1");
  assert.equal(postedPayload.generatedAt, FIXED_NOW.toISOString());
  assert.match(postedPayload.marketDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(postedPayload.records.length, 1);
  assert.equal(postedPayload.records[0].ticker, "7203");
  assert.equal(postedPayload.records[0].latestAdjustedClose, 379);
  assert.ok(logs.every((message) => !message.includes("7203") && !message.includes(SECRET)));
});

test("a malformed Yahoo response aborts without publishing a partial snapshot", async () => {
  let postCount = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === CONFIG_PATH) {
      return jsonResponse({
        schemaVersion: "public-scan-config.v1",
        universeVersion: "jp-test-v1",
        market: "JP",
        timeZone: "Asia/Tokyo",
        tickers: ["7203"],
      });
    }
    if (url.pathname === INGEST_PATH) {
      postCount += 1;
      return jsonResponse({ accepted: true }, 202);
    }
    return jsonResponse({ chart: { result: null, error: { code: "Not Found" } } });
  };

  await assert.rejects(
    runPublicMarketScan({
      baseUrl: BASE_URL,
      secret: SECRET,
      fetchImpl,
      now: () => new Date(FIXED_NOW),
      logger: { info() {} },
    }),
    /aborted/,
  );
  assert.equal(postCount, 0);
});

test("base URL suffixes and unexpected config fields fail closed", async () => {
  await assert.rejects(
    runPublicMarketScan({
      baseUrl: `${BASE_URL}/unexpected`,
      secret: SECRET,
      fetchImpl: async () => jsonResponse({}),
      now: () => new Date(FIXED_NOW),
      logger: { info() {} },
    }),
    /clean origin/,
  );

  await assert.rejects(
    runPublicMarketScan({
      baseUrl: BASE_URL,
      secret: SECRET,
      fetchImpl: async () => jsonResponse({
        schemaVersion: "public-scan-config.v1",
        universeVersion: "jp-test-v1",
        market: "JP",
        timeZone: "Asia/Tokyo",
        tickers: ["7203"],
        strategyThreshold: 123,
      }),
      now: () => new Date(FIXED_NOW),
      logger: { info() {} },
    }),
    /unexpected or missing fields/,
  );
});

test("ingest retries transient failure with a fresh HMAC timestamp", async () => {
  const timestamps = [];
  const waits = [];
  let calls = 0;
  await postPublicScan({
    baseUrl: BASE_URL,
    secret: SECRET,
    payload: { schemaVersion: SCHEMA_VERSION, records: [] },
    fetchImpl: async (_input, options) => {
      calls += 1;
      timestamps.push(options.headers["x-public-scan-timestamp"]);
      assertSignedRequest(options, INGEST_PATH, options.body);
      return jsonResponse({}, calls === 1 ? 503 : 200);
    },
    now: () => new Date(FIXED_NOW),
    retryDelay: async (milliseconds) => waits.push(milliseconds),
    random: () => 0.5,
  });
  assert.equal(calls, 2);
  assert.equal(Number(timestamps[1]), Number(timestamps[0]) + 1);
  assert.deepEqual(waits, [1_000]);
});

test("config retrieval retries transport failure with a fresh HMAC timestamp", async () => {
  const timestamps = [];
  const waits = [];
  let calls = 0;
  const config = await getPublicScanConfig({
    baseUrl: BASE_URL,
    secret: SECRET,
    fetchImpl: async (_input, options) => {
      calls += 1;
      timestamps.push(options.headers["x-public-scan-timestamp"]);
      assertSignedRequest(options, CONFIG_PATH, "");
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse({
        schemaVersion: "public-scan-config.v1",
        universeVersion: "jp-test-v1",
        market: "JP",
        timeZone: "Asia/Tokyo",
        tickers: ["7203"],
      });
    },
    now: () => new Date(FIXED_NOW),
    retryDelay: async (milliseconds) => waits.push(milliseconds),
    random: () => 0.5,
  });
  assert.equal(config.universeVersion, "jp-test-v1");
  assert.equal(calls, 2);
  assert.equal(Number(timestamps[1]), Number(timestamps[0]) + 1);
  assert.deepEqual(waits, [1_000]);
});
