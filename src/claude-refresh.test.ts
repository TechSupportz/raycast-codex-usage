import assert from "node:assert/strict";
import test from "node:test";
import { mergeClaudeOAuthCredentials, shouldRefresh } from "./providers/claude-refresh.ts";

const now = Date.parse("2026-07-27T00:00:00Z");

test("refreshes Claude credentials within the one-minute expiry window", () => {
  assert.equal(shouldRefresh({ expiresAt: now + 60_001 }, now), false);
  assert.equal(shouldRefresh({ expiresAt: now + 60_000 }, now), true);
  assert.equal(shouldRefresh({ expiresAt: now - 1 }, now), true);
  assert.equal(shouldRefresh({ expiresAt: null }, now), false);
});

test("merges a rotated OAuth token without dropping Claude credential metadata", () => {
  assert.deepEqual(
    mergeClaudeOAuthCredentials(
      {
        installationId: "installation",
        claudeAiOauth: {
          accessToken: "old-access",
          refreshToken: "old-refresh",
          expiresAt: 1,
          scopes: ["user:profile", "user:inference"],
          subscriptionType: "pro",
        },
      },
      {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      },
      now,
    ),
    {
      installationId: "installation",
      claudeAiOauth: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: now + 3_600_000,
        scopes: ["user:profile", "user:inference"],
        subscriptionType: "pro",
      },
    },
  );
});

test("keeps the current refresh token when Claude does not rotate it", () => {
  const merged = mergeClaudeOAuthCredentials(
    {
      claudeAiOauth: {
        accessToken: "old-access",
        refreshToken: "old-refresh",
      },
    },
    {
      accessToken: "new-access",
      refreshToken: null,
      expiresIn: 60,
    },
    now,
  );

  assert.equal((merged.claudeAiOauth as Record<string, unknown>).refreshToken, "old-refresh");
});
