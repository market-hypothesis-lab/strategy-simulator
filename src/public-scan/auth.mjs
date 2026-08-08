import { createHmac } from "node:crypto";

const MINIMUM_SECRET_LENGTH = 32;

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function signatureInput({ method, path, timestamp, rawBody = "" }) {
  const normalizedMethod = requireNonEmptyString(method, "method").toUpperCase();
  const normalizedPath = requireNonEmptyString(path, "path");
  const normalizedTimestamp = requireNonEmptyString(String(timestamp), "timestamp");

  if (!normalizedPath.startsWith("/") || normalizedPath.includes("\n")) {
    throw new TypeError("path must be a newline-free absolute pathname");
  }
  if (!/^[0-9]+$/.test(normalizedTimestamp)) {
    throw new TypeError("timestamp must contain Unix-time digits only");
  }
  if (typeof rawBody !== "string") {
    throw new TypeError("rawBody must be a string");
  }

  return `${normalizedMethod}\n${normalizedPath}\n${normalizedTimestamp}\n${rawBody}`;
}

export function createSignature(secret, request) {
  requireNonEmptyString(secret, "secret");
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new TypeError(`secret must contain at least ${MINIMUM_SECRET_LENGTH} characters`);
  }
  return createHmac("sha256", secret).update(signatureInput(request), "utf8").digest("hex");
}

export function createSignedHeaders({ secret, method, path, timestamp, rawBody = "" }) {
  const signature = createSignature(secret, { method, path, timestamp, rawBody });
  return {
    "x-public-scan-timestamp": String(timestamp),
    "x-public-scan-signature": `sha256=${signature}`,
  };
}
