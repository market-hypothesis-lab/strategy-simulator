# Data policy

This repository may contain source code, schemas, documentation, tests, and
synthetic fixtures only.

Do not commit:

- API keys, webhook URLs, credentials, private keys, or session tokens
- Real experiment ledgers, positions, audit records, or unpublished results
- Market data or source documents without confirmed redistribution rights
- Personal information or organization-internal notes

Operational materials belong in the private
`market-hypothesis-lab/strategy-operations` repository or approved encrypted
storage. Secrets must use GitHub Secrets or a local secret manager even when the
repository is private.

When reproducibility requires external source material, prefer a lawful locator,
retrieval timestamp, and SHA-256 digest over storing the source document.

Everything under `examples/` is fictional and exists only to demonstrate the
public simulator API.

