import assert from "node:assert/strict";
import test from "node:test";
import { parseClaudeUsagePayload } from "./providers/claude-usage.ts";

test("parses Claude's named usage windows", () => {
  assert.deepEqual(
    parseClaudeUsagePayload({
      five_hour: {
        utilization: 23.5,
        resets_at: "2026-07-25T12:00:00Z",
      },
      seven_day: {
        utilization: 41.2,
        resets_at: "2026-07-28T00:00:00Z",
      },
      seven_day_opus: {
        utilization: 12,
        resets_at: 1_774_915_200,
      },
      extra_usage: {
        is_enabled: true,
      },
    }),
    [
      {
        id: "five_hour",
        label: "Session Limit",
        usedPercent: 23.5,
        resetsAt: Date.parse("2026-07-25T12:00:00Z"),
      },
      {
        id: "seven_day",
        label: "Weekly Limit",
        usedPercent: 41.2,
        resetsAt: Date.parse("2026-07-28T00:00:00Z"),
      },
      {
        id: "seven_day_opus",
        label: "Opus Weekly Limit",
        usedPercent: 12,
        resetsAt: 1_774_915_200_000,
      },
    ],
  );
});

test("keeps compatibility with the legacy limits array", () => {
  assert.deepEqual(
    parseClaudeUsagePayload({
      limits: [
        {
          kind: "session",
          percent: 10,
          resets_at: "2026-07-25T12:00:00Z",
        },
      ],
    }),
    [
      {
        id: "session",
        label: "Session Limit",
        usedPercent: 10,
        resetsAt: Date.parse("2026-07-25T12:00:00Z"),
      },
    ],
  );
});

test("rejects responses without usage windows", () => {
  assert.throws(() => parseClaudeUsagePayload({ extra_usage: {} }), /unexpected usage response/);
});
