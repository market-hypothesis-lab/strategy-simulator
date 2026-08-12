import { createHash } from "node:crypto";

const SOURCE_KINDS = new Set(["github_release_asset", "github_repository_file"]);
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requireText(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`${field} must be non-empty text`);
  }
  return value;
}

function requireInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

export function validateSourceRegistry(raw) {
  if (raw?.schemaVersion !== "public-data-sources.v1" || !Array.isArray(raw.sources)) {
    throw new Error("unsupported source registry");
  }
  const ids = new Set();
  return raw.sources.map((source, index) => {
    const field = `sources[${index}]`;
    const sourceId = requireText(source.sourceId, `${field}.sourceId`);
    if (ids.has(sourceId)) throw new Error("sourceId must be unique");
    ids.add(sourceId);
    if (!SOURCE_KINDS.has(source.kind)) throw new Error(`${field}.kind is unsupported`);
    const repository = requireText(source.repository, `${field}.repository`);
    if (!REPOSITORY.test(repository)) throw new Error(`${field}.repository is invalid`);
    const normalized = {
      ...source,
      sourceId,
      repository,
      ref: requireText(source.ref, `${field}.ref`),
      license: requireText(source.license, `${field}.license`),
      usage: requireText(source.usage, `${field}.usage`),
      maximumAgeHours: requireInteger(source.maximumAgeHours, `${field}.maximumAgeHours`),
      minimumBytes: requireInteger(source.minimumBytes, `${field}.minimumBytes`),
      maximumBytes: requireInteger(source.maximumBytes, `${field}.maximumBytes`),
    };
    if (normalized.minimumBytes >= normalized.maximumBytes) {
      throw new Error(`${field} byte limits are invalid`);
    }
    if (source.kind === "github_release_asset") {
      normalized.assetName = requireText(source.assetName, `${field}.assetName`);
    } else {
      normalized.path = requireText(source.path, `${field}.path`);
      normalized.requiredHeader = requireText(source.requiredHeader, `${field}.requiredHeader`);
    }
    return Object.freeze(normalized);
  });
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "market-hypothesis-lab-source-audit/1",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function checkedFetch(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`);
  return response;
}

function ageHours(updatedAt, now) {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 300_000) {
    throw new Error("upstream timestamp is invalid");
  }
  return (now.getTime() - timestamp) / 3_600_000;
}

function checkSize(source, size) {
  if (!Number.isSafeInteger(size) || size < source.minimumBytes || size > source.maximumBytes) {
    throw new Error("upstream size is outside the allowlist bounds");
  }
}

async function auditReleaseAsset(source, { fetchImpl, token, now }) {
  const api = `https://api.github.com/repos/${source.repository}/releases/tags/${encodeURIComponent(source.ref)}`;
  const release = await (await checkedFetch(fetchImpl, api, { headers: githubHeaders(token) })).json();
  const asset = release.assets?.find((item) => item.name === source.assetName);
  if (!asset) throw new Error("allowlisted release asset is missing");
  checkSize(source, asset.size);
  const observedAge = ageHours(asset.updated_at, now);
  if (observedAge > source.maximumAgeHours) throw new Error("release asset is stale");
  if (typeof asset.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
    throw new Error("release asset has no GitHub SHA-256 digest");
  }
  return {
    sourceId: source.sourceId,
    status: "verified_metadata",
    repository: source.repository,
    immutableLocator: `github-release://${source.repository}/${release.id}/${asset.id}`,
    upstreamUpdatedAt: asset.updated_at,
    bytes: asset.size,
    sha256: asset.digest.slice(7),
    usage: source.usage,
    priceAdjustment: "unadjusted",
  };
}

async function auditRepositoryFile(source, { fetchImpl, token, now }) {
  const commitApi = `https://api.github.com/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`;
  const commit = await (await checkedFetch(fetchImpl, commitApi, { headers: githubHeaders(token) })).json();
  if (!/^[0-9a-f]{40}$/.test(commit.sha ?? "")) throw new Error("commit SHA is invalid");
  const rawUrl = `https://raw.githubusercontent.com/${source.repository}/${commit.sha}/${source.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await checkedFetch(fetchImpl, rawUrl, { headers: { "User-Agent": "market-hypothesis-lab-source-audit/1" } });
  const bytes = new Uint8Array(await response.arrayBuffer());
  checkSize(source, bytes.byteLength);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].trim();
  if (firstLine !== source.requiredHeader) throw new Error("repository file header changed");
  const updatedAt = commit.commit?.committer?.date;
  if (ageHours(updatedAt, now) > source.maximumAgeHours) throw new Error("repository file is stale");
  return {
    sourceId: source.sourceId,
    status: "verified_content",
    repository: source.repository,
    immutableLocator: `github-file://${source.repository}/${commit.sha}/${source.path}`,
    upstreamUpdatedAt: updatedAt,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    usage: source.usage,
  };
}

export async function auditSources(sources, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const token = options.token ?? "";
  const results = [];
  for (const source of sources) {
    try {
      const result = source.kind === "github_release_asset"
        ? await auditReleaseAsset(source, { fetchImpl, token, now })
        : await auditRepositoryFile(source, { fetchImpl, token, now });
      results.push(result);
    } catch (error) {
      results.push({ sourceId: source.sourceId, status: "rejected", reason: error.message });
    }
  }
  return {
    schemaVersion: "public-source-audit.v1",
    generatedAt: now.toISOString(),
    safeForTradingSignals: false,
    sources: results,
  };
}
