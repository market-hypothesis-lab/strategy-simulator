import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { createSignature, createSignedHeaders, signatureInput } from "../src/public-scan/auth.mjs";

const SECRET = "fixture-secret-0123456789-abcdef-0123456789";

test("signature input uses the documented method/path/timestamp/raw-body format", () => {
  const request = {
    method: "post",
    path: "/internal/public-scan/v1",
    timestamp: "1786201200",
    rawBody: "{\"hello\":\"world\"}",
  };
  const input = "POST\n/internal/public-scan/v1\n1786201200\n{\"hello\":\"world\"}";

  assert.equal(signatureInput(request), input);
  assert.equal(
    createSignature(SECRET, request),
    createHmac("sha256", SECRET).update(input, "utf8").digest("hex"),
  );
});

test("signed headers use lowercase names and a sha256 prefix", () => {
  const headers = createSignedHeaders({
    secret: SECRET,
    method: "GET",
    path: "/internal/public-scan/v1/config",
    timestamp: "1786201200",
    rawBody: "",
  });

  assert.equal(headers["x-public-scan-timestamp"], "1786201200");
  assert.match(headers["x-public-scan-signature"], /^sha256=[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(headers).sort(), ["x-public-scan-signature", "x-public-scan-timestamp"]);
});

test("short secrets and newline-bearing paths are rejected", () => {
  assert.throws(
    () => createSignature("short", { method: "GET", path: "/ok", timestamp: "1", rawBody: "" }),
    /at least 32/,
  );
  assert.throws(
    () => signatureInput({ method: "GET", path: "/bad\npath", timestamp: "1", rawBody: "" }),
    /newline-free/,
  );
});
