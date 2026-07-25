import assert from "node:assert/strict";
import test from "node:test";
import { formatResetTimeRemaining, parseResetExpiry } from "./reset-expiry.ts";

const now = Date.parse("2026-07-10T20:00:00Z");

test("treats offset-less reset timestamps as UTC", () => {
  assert.equal(parseResetExpiry("2026-07-24T00:00:00"), Date.parse("2026-07-24T00:00:00Z"));
  assert.equal(formatResetTimeRemaining("2026-07-24T00:00:00", now), "13d");
});

test("preserves explicitly zoned reset timestamps", () => {
  assert.equal(parseResetExpiry("2026-07-24T00:00:00+08:00"), Date.parse("2026-07-24T00:00:00+08:00"));
});

test("uses hours when two days or fewer remain", () => {
  assert.equal(formatResetTimeRemaining("2026-07-12T20:00:00Z", now), "48h");
  assert.equal(formatResetTimeRemaining("2026-07-12T19:01:00Z", now), "48h");
  assert.equal(formatResetTimeRemaining("2026-07-12T20:00:01Z", now), "2d");
});
