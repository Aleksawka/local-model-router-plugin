import assert from "node:assert/strict";
import test from "node:test";
import { parsePort } from "../src/parse-port.js";

test("accepts a valid numeric port", () => {
  assert.equal(parsePort(443), 443);
});

test("accepts a valid numeric string", () => {
  assert.equal(parsePort("8080"), 8080);
});

test("rejects non-integer input", () => {
  assert.throws(() => parsePort("abc"), TypeError);
});
