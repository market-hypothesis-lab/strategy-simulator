import { runPublicMarketScan } from "../src/public-scan/client.mjs";

try {
  await runPublicMarketScan({
    baseUrl: process.env.PUBLIC_SCAN_BASE_URL,
    secret: process.env.PUBLIC_SCAN_HMAC_SECRET,
  });
} catch (error) {
  // Keep live tickers, payloads, response bodies, and credentials out of logs.
  console.error(error instanceof Error ? error.message : "Public scan failed");
  process.exitCode = 1;
}
