import assert from "node:assert/strict";
import test from "node:test";

import { fetchYahooFeatureVector } from "../src/public-scan/yahoo.mjs";
import { makeYahooChartFixture } from "./fixtures/yahoo-chart.fixture.mjs";

test("Yahoo retries a transport failure and honors Retry-After", async () => {
  let calls = 0;
  const waits = [];
  const result = await fetchYahooFeatureVector("7203.T", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      if (calls === 2) {
        return new Response(null, { status: 429, headers: { "Retry-After": "2" } });
      }
      return new Response(JSON.stringify(makeYahooChartFixture()), {
        headers: { "Content-Type": "application/json" },
      });
    },
    retryDelay: async (milliseconds) => waits.push(milliseconds),
    random: () => 0.5,
  });
  assert.equal(result.ticker, "7203.T");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1_000, 2_000]);
});

test("Yahoo does not retry a validated permanent response failure", async () => {
  let calls = 0;
  await assert.rejects(fetchYahooFeatureVector("7203.T", {
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    },
    retryDelay: async () => assert.fail("permanent failure must not wait"),
  }), /retrieval or validation failed/u);
  assert.equal(calls, 1);
});
