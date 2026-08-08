export const FIXTURE_TICKER = "7203.T";
export const FIXTURE_POINT_COUNT = 280;
export const FIXTURE_START_TIMESTAMP = Date.parse("2025-01-01T00:00:00.000Z") / 1000;

export function makeYahooChartFixture(ticker = FIXTURE_TICKER) {
  const timestamps = Array.from(
    { length: FIXTURE_POINT_COUNT },
    (_, index) => FIXTURE_START_TIMESTAMP + (index * 86_400),
  );
  const adjustedCloses = Array.from(
    { length: FIXTURE_POINT_COUNT },
    (_, index) => 100 + index,
  );
  const volumes = Array.from({ length: FIXTURE_POINT_COUNT }, () => 1_000_000);
  volumes[volumes.length - 1] = 2_000_000;

  return {
    chart: {
      result: [{
        meta: { symbol: ticker },
        timestamp: timestamps,
        indicators: {
          adjclose: [{ adjclose: adjustedCloses }],
          quote: [{ close: [...adjustedCloses], volume: volumes }],
        },
      }],
      error: null,
    },
  };
}
