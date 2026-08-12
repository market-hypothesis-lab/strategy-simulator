# Data policy

This public repository may persist source code, schemas, documentation, tests,
and synthetic fixtures only.

## Allowed transient retrieval

The `public-market-scan.yml` runtime may retrieve market observations when the
retrieval and use are lawful and comply with the source's applicable terms. Raw
responses may exist in process memory only for the time required to validate
them and calculate the documented generic feature vector.

The runtime may send that derived vector directly to the authenticated private
endpoint. This permission does not permit redistribution or persistence in this
public repository. Source availability does not establish a right to copy,
retain, or redistribute data.

## Never persist or expose here

Do not commit, cache, upload as an artifact, print to an Actions log, or place in
an Actions output:

- raw or normalized live market observations;
- live calculated scan records, result payloads, or ticker allowlists;
- real experiment ledgers, positions, audit records, or unpublished results;
- API keys, webhook URLs, HMAC secrets, credentials, private keys, or tokens;
- source documents or market data without confirmed redistribution rights;
- personal information or organization-internal notes.

Failures and success logs must be limited to non-sensitive status, counts, and
dates. They must not include a ticker, URL query, response body, request body,
signature, or secret.

For an explicit non-`.T` index or futures series whose source does not publish
volume, `volumeRatio20 = 0` is an availability sentinel. It must not be treated
as a low-volume observation or used directly as a buy/sell feature. Missing
volume for a `.T` security is a validation failure.

Operational materials and received scan snapshots belong in the private
`market-hypothesis-lab/strategy-operations` system or approved encrypted
storage. Secrets must use GitHub Actions Secrets or a private secret manager.

When reproducibility requires external source material, prefer a lawful locator,
retrieval timestamp, and SHA-256 digest in private storage over storing the
source document here.

The source-audit workflow may persist a provenance manifest containing only an
immutable locator, retrieval time, byte count, license label, and SHA-256. It
must not persist the inspected source body. A source that is stale, missing,
oversized, schema-incompatible, or lacks its required digest is rejected and
must never be silently substituted into a trading signal.

Everything under `examples/` and `tests-js/fixtures/` is fictional and exists
only to demonstrate and test the public interfaces.
