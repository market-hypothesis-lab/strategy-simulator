# Strategy Simulator

This repository contains two deliberately generic research components:

- a deterministic Python rule/equity simulator for synthetic or properly
  licensed observations; and
- a dependency-free Node.js compute plane that transiently retrieves Yahoo
  Finance chart data, calculates a fixed feature vector, and sends only that
  vector to an authenticated private endpoint.

Live strategy thresholds, positions, operational history, Discord webhooks, and
private scan results remain in the private
`market-hypothesis-lab/strategy-operations` repository.

## Public compute flow

1. An external private scheduler dispatches `public-market-scan.yml`.
2. The job signs `GET /internal/public-scan/v1/config` and receives a versioned
   allowlist of at most 400 internal ticker codes.
3. Yahoo chart responses are held in memory only. Japanese security codes such
   as `1301` and `285A` gain `.T` only for the Yahoo request. Explicit symbols
   such as `^N225`, `GC=F`, and already suffixed symbols pass through unchanged.
4. The job computes the versioned features and signs
   `POST /internal/public-scan/v1`. Each returned record retains its original
   internal ticker code.
5. No raw response, live payload, cache, or artifact is written or uploaded.

The workflow has **only** `workflow_dispatch`; it intentionally has no
`schedule` trigger. GitHub's public-repository rule that disables *scheduled*
workflows after 60 days without repository activity therefore does not apply to
this workflow. Daily automation must keep dispatching it from the private
control plane.

The private control plane accepts a snapshot as a daily input only after exact
ticker coverage and same-market-date validation. Its first history bootstrap
remains private and Yahoo-based; after parity approval, the private daily job
can append the current close from this snapshot and skip the full 225-code
Yahoo acquisition. A failed, stale, partial, or schema-incompatible snapshot
is never used as a partial result: the private workflow falls back to its
existing Yahoo path before mutating state. This repository owns transient
market computation, while the private repository owns thresholds, state,
lifecycle decisions, Discord, and the member dashboard.

## GitHub Actions configuration

Create a `public-scan-production` GitHub Environment, restrict its deployment
branches to `main`, and configure:

- Environment Variable `PUBLIC_SCAN_BASE_URL`: the HTTPS origin of the private
  gateway, without the API path.
- Environment Secret `PUBLIC_SCAN_HMAC_SECRET`: a random value containing at
  least 32 characters, shared only with the private gateway.

There is intentionally no hard-coded fallback URL. The effective POST target
is `${PUBLIC_SCAN_BASE_URL}/internal/public-scan/v1`; a missing variable or
secret fails closed. The secret must not also exist as a Repository Secret:
otherwise another branch could remove the Environment from its workflow before
dispatch. It is exposed only to the final scan process, not to checkout, setup,
or tests. The job uses read-only repository permissions, pinned action
revisions, checkout with persisted credentials disabled, an Environment
deployment-branch restriction, and a job guard that permits only `main`.

## Authentication contract

Both API calls carry these headers:

```text
X-Public-Scan-Timestamp: <Unix seconds>
X-Public-Scan-Signature: sha256=<lowercase HMAC-SHA256 hex>
```

The exact UTF-8 signature input is:

```text
METHOD\nPATH\nTIMESTAMP\nRAW_BODY
```

`METHOD` is uppercase and `PATH` is the pathname only. The config GET signs an
empty body. The POST signs the exact JSON bytes sent on the wire.

Both the URL and HMAC value belong to the `public-scan-production`
Environment. Do not create a repository-level variable with the same name:
organization repository write access can change repository variables, whereas
the Environment and its deployment-branch restriction are the control
boundary for this job. Protect `main` from direct pushes and require review for
workflow or public-scan code changes; an Environment branch restriction does
not make unreviewed code on `main` safe.

The config response contract is:

```json
{
  "schemaVersion": "public-scan-config.v1",
  "universeVersion": "version-from-private-control-plane",
  "market": "JP",
  "timeZone": "Asia/Tokyo",
  "tickers": ["1301", "285A", "^N225"]
}
```

The POST envelope is fixed:

```json
{
  "schemaVersion": "public-scan.v1",
  "source": "market-hypothesis-lab/strategy-simulator",
  "featureSchemaVersion": "technical-features.v1",
  "universeVersion": "version-from-private-control-plane",
  "marketDate": "YYYY-MM-DD",
  "generatedAt": "ISO-8601 timestamp",
  "records": []
}
```

Each record contains `ticker`, `observedAt`, `sampleCount`,
`latestAdjustedClose`, `previousAdjustedClose`, `sma20`, `sma50`, `sma200`,
`sma200Prior20`, `sma200Delta20`, `prior252DayMax`, `zScore20`,
`zScore20Previous`, `return20`, `return60`, `annualizedVolatility20`,
`annualizedVolatility60`, and `volumeRatio20`.

Calculations require at least 253 usable observations. Prices use Yahoo's
`quote.close` series rather than the dividend-adjusted `adjclose` series so the
derived comparisons match the private quote-series basis; the historical
`*AdjustedClose` field names are retained as part of the versioned wire schema.
Every vector is normalized to the latest 253 usable observations, so
`sampleCount` is always 253 and an unchanged holiday refetch remains
deterministic even if Yahoo's rolling two-year response drops an old row.
`prior252DayMax` excludes the current session. Z-scores use log prices and the population standard
deviation of their 20-session window. Volatility uses the population standard
deviation of 20 or 60 daily log returns and annualizes by `sqrt(252)`.
`volumeRatio20` compares the latest volume with the preceding 20-session
average. Total returns remain simple returns. Returns and volatility are
fractions, not percentages. Every numeric feature is finite and rounded to
eight decimal places.

If an explicit non-`.T` index or futures series does not publish volume, missing
volume is normalized to zero and `volumeRatio20 = 0` means unavailable; private
strategy logic must not treat it as a low-volume signal. A `.T` security with
missing volume fails closed.

The scan is atomic: if any configured ticker cannot produce the complete
feature vector, no partial snapshot is published. To tolerate a temporary
trading halt, an otherwise valid record may lag the latest market date by up to
14 calendar days, but at least 80% of records must match the latest date.
Authenticated config retrieval, Yahoo retrieval, and the final authenticated
ingest use bounded retries for transient transport errors, rate limits, and
selected gateway/server failures. Each authenticated retry generates a fresh
timestamp and HMAC signature; ingest keeps the exact JSON body unchanged.

## Local tests and demos

```powershell
npm run test:node
python -m unittest discover -s tests -v
python -m strategy_simulator examples/demo-strategy.json examples/demo-case.json
```

Node.js 20.12 or newer is required. Node tests use synthetic fixtures and a
mocked `fetch`; they do not contact Yahoo or the private gateway.

## Public/private boundary

Do not copy live strategy configuration, unpublished results, real positions,
licensed market data, credentials, ticker allowlists, or webhook URLs into this
repository. See [DATA_POLICY.md](DATA_POLICY.md) for the complete boundary.

## License status

No open-source license has been selected yet. Public visibility permits reading
the repository but does not by itself grant rights to copy, modify, or
redistribute the source code.

## Disclaimer

This software is a research tool. It is not investment advice, a trading signal,
or an order-execution system.
