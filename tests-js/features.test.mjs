import assert from "node:assert/strict";
import test from "node:test";

import { computeFeatureVector, featureConstants, normalizeYahooChart } from "../src/public-scan/features.mjs";
import {
  FIXTURE_POINT_COUNT,
  FIXTURE_START_TIMESTAMP,
  FIXTURE_TICKER,
  makeYahooChartFixture,
} from "./fixtures/yahoo-chart.fixture.mjs";

test("synthetic Yahoo fixture produces the fixed deterministic feature vector", () => {
  const payload = makeYahooChartFixture();
  payload.chart.result[0].indicators.adjclose[0].adjclose =
    payload.chart.result[0].indicators.adjclose[0].adjclose.map((value) => value * 0.5);
  const observations = normalizeYahooChart(payload, FIXTURE_TICKER);
  const feature = computeFeatureVector(FIXTURE_TICKER, observations);

  assert.equal(feature.sampleCount, featureConstants.requiredSampleCount);
  assert.equal(feature.observedAt, new Date((FIXTURE_START_TIMESTAMP + ((FIXTURE_POINT_COUNT - 1) * 86_400)) * 1000).toISOString());
  assert.equal(feature.latestAdjustedClose, 379);
  assert.equal(feature.previousAdjustedClose, 378);
  assert.equal(feature.sma20, 369.5);
  assert.equal(feature.sma50, 354.5);
  assert.equal(feature.sma200, 279.5);
  assert.equal(feature.sma200Prior20, 259.5);
  assert.equal(feature.sma200Delta20, 20);
  assert.equal(feature.prior252DayMax, 378);
  assert.equal(feature.zScore20, 1.63421296);
  assert.equal(feature.zScore20Previous, 1.63417708);
  assert.equal(feature.return20, 0.05571031);
  assert.equal(feature.return60, 0.18808777);
  assert.equal(feature.annualizedVolatility20, 0.00067263);
  assert.equal(feature.annualizedVolatility60, 0.0022694);
  assert.equal(feature.volumeRatio20, 2);
});

test("null market rows are discarded but malformed aligned arrays are rejected", () => {
  const payload = makeYahooChartFixture();
  payload.chart.result[0].timestamp.push(FIXTURE_START_TIMESTAMP + (FIXTURE_POINT_COUNT * 86_400));
  payload.chart.result[0].indicators.adjclose[0].adjclose.push(null);
  payload.chart.result[0].indicators.quote[0].close.push(null);
  payload.chart.result[0].indicators.quote[0].volume.push(null);
  assert.equal(normalizeYahooChart(payload, FIXTURE_TICKER).length, FIXTURE_POINT_COUNT);

  payload.chart.result[0].indicators.quote[0].volume.pop();
  assert.throws(() => normalizeYahooChart(payload, FIXTURE_TICKER), /equal lengths/);
});

test("JP volume defects fail closed while explicit index volume uses a zero sentinel", () => {
  const observations = normalizeYahooChart(makeYahooChartFixture(), FIXTURE_TICKER);
  assert.throws(
    () => computeFeatureVector(FIXTURE_TICKER, observations.slice(-(featureConstants.requiredSampleCount - 1))),
    /at least 253/,
  );

  observations.at(-1).volume = null;
  assert.throws(() => computeFeatureVector(FIXTURE_TICKER, observations), /latest 21/);

  const equityPayload = makeYahooChartFixture(FIXTURE_TICKER);
  delete equityPayload.chart.result[0].indicators.quote[0].volume;
  assert.throws(
    () => normalizeYahooChart(equityPayload, FIXTURE_TICKER),
    /volume array for a JP security/,
  );

  const indexPayload = makeYahooChartFixture("^N225");
  delete indexPayload.chart.result[0].indicators.quote[0].volume;
  const indexObservations = normalizeYahooChart(indexPayload, "^N225");
  assert.equal(computeFeatureVector("^N225", indexObservations).volumeRatio20, 0);
});
