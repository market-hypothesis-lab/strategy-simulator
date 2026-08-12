import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { auditSources, validateSourceRegistry } from "../src/public-scan/source-audit.mjs";

const now = new Date("2026-08-13T12:00:00.000Z");

function registry() {
  return {
    schemaVersion: "public-data-sources.v1",
    sources: [
      {
        sourceId: "bars",
        kind: "github_release_asset",
        repository: "owner/bars",
        ref: "data-us-bars",
        assetName: "us_bars.parquet",
        license: "MIT",
        maximumAgeHours: 96,
        minimumBytes: 10,
        maximumBytes: 1000,
        usage: "shadow_only",
      },
      {
        sourceId: "members",
        kind: "github_repository_file",
        repository: "owner/members",
        ref: "main",
        path: "members.csv",
        license: "MIT",
        maximumAgeHours: 96,
        minimumBytes: 10,
        maximumBytes: 1000,
        requiredHeader: "date,tickers",
        usage: "bias_control",
      },
    ],
  };
}

test("audits immutable GitHub provenance without returning raw data", async () => {
  const content = new TextEncoder().encode("date,tickers\n2026-08-12,AAPL;MSFT\n");
  const digest = createHash("sha256").update(content).digest("hex");
  const fetchImpl = async (url) => {
    if (url.includes("/releases/tags/")) {
      return new Response(JSON.stringify({ id: 7, assets: [{
        id: 8, name: "us_bars.parquet", size: 100, updated_at: "2026-08-13T00:00:00Z",
        digest: `sha256:${"a".repeat(64)}`,
      }] }), { status: 200 });
    }
    if (url.includes("/commits/")) {
      return new Response(JSON.stringify({
        sha: "b".repeat(40), commit: { committer: { date: "2026-08-12T00:00:00Z" } },
      }), { status: 200 });
    }
    return new Response(content, { status: 200 });
  };
  const report = await auditSources(validateSourceRegistry(registry()), { fetchImpl, now });
  assert.deepEqual(report.sources.map((source) => source.status), ["verified_metadata", "verified_content"]);
  assert.equal(report.sources[1].sha256, digest);
  assert.equal(report.safeForTradingSignals, false);
  assert.equal(JSON.stringify(report).includes("AAPL"), false);
});

test("rejects stale, missing-digest, and changed-schema sources", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/releases/tags/")) {
      return new Response(JSON.stringify({ id: 7, assets: [{
        id: 8, name: "us_bars.parquet", size: 100, updated_at: "2026-01-01T00:00:00Z",
      }] }), { status: 200 });
    }
    if (url.includes("/commits/")) {
      return new Response(JSON.stringify({
        sha: "b".repeat(40), commit: { committer: { date: "2026-08-12T00:00:00Z" } },
      }), { status: 200 });
    }
    return new Response("wrong,header\n", { status: 200 });
  };
  const report = await auditSources(validateSourceRegistry(registry()), { fetchImpl, now });
  assert.deepEqual(report.sources.map((source) => source.status), ["rejected", "rejected"]);
});

test("registry rejects duplicate ids and unsafe size limits", () => {
  const raw = registry();
  raw.sources[1].sourceId = "bars";
  assert.throws(() => validateSourceRegistry(raw), /unique/);
  const invalid = registry();
  invalid.sources[0].minimumBytes = invalid.sources[0].maximumBytes;
  assert.throws(() => validateSourceRegistry(invalid), /byte limits/);
});
