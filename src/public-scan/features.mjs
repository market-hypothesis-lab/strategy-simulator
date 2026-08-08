const FEATURE_DECIMALS = 8;
const TRADING_DAYS_PER_YEAR = 252;
const REQUIRED_SAMPLE_COUNT = 253;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStandardDeviation(values) {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function logReturns(prices, periodCount) {
  const window = prices.slice(-(periodCount + 1));
  if (window.length !== periodCount + 1) {
    throw new RangeError(`at least ${periodCount + 1} prices are required`);
  }
  return window.slice(1).map((price, index) => Math.log(price / window[index]));
}

function movingAverage(prices, periodCount, endOffset = 0) {
  const end = endOffset === 0 ? prices.length : prices.length - endOffset;
  const start = end - periodCount;
  if (start < 0) {
    throw new RangeError(`at least ${periodCount + endOffset} prices are required`);
  }
  return mean(prices.slice(start, end));
}

function zScore(prices, periodCount, endOffset = 0) {
  const end = endOffset === 0 ? prices.length : prices.length - endOffset;
  const start = end - periodCount;
  const window = prices.slice(start, end).map((price) => Math.log(price));
  if (start < 0 || window.length !== periodCount) {
    throw new RangeError(`at least ${periodCount + endOffset} prices are required`);
  }
  const deviation = populationStandardDeviation(window);
  if (deviation === 0) {
    return 0;
  }
  return (window.at(-1) - mean(window)) / deviation;
}

function annualizedVolatility(prices, periodCount) {
  return populationStandardDeviation(logReturns(prices, periodCount)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

export function roundFeature(value) {
  if (!isFiniteNumber(value)) {
    throw new TypeError("feature value must be finite");
  }
  const rounded = Number(value.toFixed(FEATURE_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeYahooChart(payload, expectedTicker) {
  const result = payload?.chart?.result?.[0];
  if (!result || payload?.chart?.error) {
    throw new TypeError("Yahoo chart response did not contain a result");
  }

  const returnedTicker = result.meta?.symbol;
  if (typeof returnedTicker !== "string" || returnedTicker.toUpperCase() !== expectedTicker.toUpperCase()) {
    throw new TypeError("Yahoo chart response symbol did not match the requested ticker");
  }

  const allowsUnavailableVolume = !expectedTicker.toUpperCase().endsWith(".T");
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  const closes = quote?.close;
  let volumes = quote?.volume;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
    throw new TypeError("Yahoo chart response was missing timestamp or quote close arrays");
  }
  if (!Array.isArray(volumes)) {
    if (!allowsUnavailableVolume) {
      throw new TypeError("Yahoo chart response was missing the volume array for a JP security");
    }
    volumes = Array.from({ length: timestamps.length }, () => null);
  }
  if (timestamps.length !== closes.length || timestamps.length !== volumes.length) {
    throw new TypeError("Yahoo chart arrays must have equal lengths");
  }

  const observations = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const adjustedClose = closes[index];
    const volume = volumes[index];

    // Yahoo can place nulls in holiday or incomplete rows. Those rows are not
    // observations and are removed before feature calculation.
    if (!Number.isInteger(timestamp) || timestamp <= 0 || !isFiniteNumber(adjustedClose) || adjustedClose <= 0) {
      continue;
    }
    observations.push({
      timestamp,
      adjustedClose,
      // Explicit index/futures series can omit volume. JP securities fail
      // closed instead of turning a data defect into a false low-volume signal.
      volume: isFiniteNumber(volume) && volume >= 0
        ? volume
        : (allowsUnavailableVolume ? 0 : null),
    });
  }

  observations.sort((left, right) => left.timestamp - right.timestamp);
  for (let index = 1; index < observations.length; index += 1) {
    if (observations[index - 1].timestamp === observations[index].timestamp) {
      throw new TypeError("Yahoo chart response contained duplicate timestamps");
    }
  }
  return observations;
}

export function computeFeatureVector(ticker, observations) {
  if (typeof ticker !== "string" || ticker.length === 0) {
    throw new TypeError("ticker must be a non-empty string");
  }
  if (!Array.isArray(observations) || observations.length < REQUIRED_SAMPLE_COUNT) {
    throw new RangeError(`at least ${REQUIRED_SAMPLE_COUNT} usable observations are required`);
  }

  // Every published vector is calculated from the same fixed tail. Yahoo's
  // rolling `2y` response can lose an old row on a market holiday even when
  // the latest market observation has not changed. Normalizing here keeps the
  // wire document deterministic across those harmless refetches.
  const featureObservations = observations.slice(-REQUIRED_SAMPLE_COUNT);
  const prices = featureObservations.map((observation) => observation.adjustedClose);
  if (prices.some((price) => !isFiniteNumber(price) || price <= 0)) {
    throw new TypeError("adjusted closes must be finite positive numbers");
  }

  const recentVolumes = featureObservations.slice(-21).map((observation) => observation.volume);
  if (recentVolumes.some((volume) => !isFiniteNumber(volume) || volume < 0)) {
    throw new TypeError("the latest 21 observations require finite non-negative volume");
  }
  const priorVolumeAverage = mean(recentVolumes.slice(0, -1));
  if (priorVolumeAverage === 0 && ticker.toUpperCase().endsWith(".T")) {
    throw new RangeError("a JP security requires positive prior 20-session average volume");
  }

  const latestTimestamp = featureObservations.at(-1).timestamp;
  if (!Number.isInteger(latestTimestamp) || latestTimestamp <= 0) {
    throw new TypeError("latest observation timestamp must be a positive integer");
  }

  const sma200 = movingAverage(prices, 200);
  const sma200Prior20 = movingAverage(prices, 200, 20);
  const prior252Prices = prices.slice(-253, -1);
  const record = {
    ticker,
    observedAt: new Date(latestTimestamp * 1000).toISOString(),
    sampleCount: featureObservations.length,
    latestAdjustedClose: roundFeature(prices.at(-1)),
    previousAdjustedClose: roundFeature(prices.at(-2)),
    sma20: roundFeature(movingAverage(prices, 20)),
    sma50: roundFeature(movingAverage(prices, 50)),
    sma200: roundFeature(sma200),
    sma200Prior20: roundFeature(sma200Prior20),
    sma200Delta20: roundFeature(sma200 - sma200Prior20),
    prior252DayMax: roundFeature(Math.max(...prior252Prices)),
    zScore20: roundFeature(zScore(prices, 20)),
    zScore20Previous: roundFeature(zScore(prices, 20, 1)),
    return20: roundFeature((prices.at(-1) / prices.at(-21)) - 1),
    return60: roundFeature((prices.at(-1) / prices.at(-61)) - 1),
    annualizedVolatility20: roundFeature(annualizedVolatility(prices, 20)),
    annualizedVolatility60: roundFeature(annualizedVolatility(prices, 60)),
    volumeRatio20: roundFeature(
      priorVolumeAverage === 0 ? 0 : recentVolumes.at(-1) / priorVolumeAverage,
    ),
  };

  for (const [name, value] of Object.entries(record)) {
    if (name === "ticker" || name === "observedAt" || name === "sampleCount") {
      continue;
    }
    if (!isFiniteNumber(value)) {
      throw new TypeError(`${name} must be finite`);
    }
  }
  return record;
}

export const featureConstants = Object.freeze({
  decimals: FEATURE_DECIMALS,
  requiredSampleCount: REQUIRED_SAMPLE_COUNT,
  tradingDaysPerYear: TRADING_DAYS_PER_YEAR,
});
