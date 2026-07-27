const REFRESH_SKEW_MS = 60_000;

export type ClaudeOAuthRefresh = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
};

export function shouldRefresh({ expiresAt }: { expiresAt: number | null }, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt <= now + REFRESH_SKEW_MS;
}

export function mergeClaudeOAuthCredentials(
  raw: Record<string, unknown>,
  refreshed: ClaudeOAuthRefresh,
  now = Date.now(),
): Record<string, unknown> {
  const existingOauth = isRecord(raw.claudeAiOauth) ? raw.claudeAiOauth : {};

  return {
    ...raw,
    claudeAiOauth: {
      ...existingOauth,
      accessToken: refreshed.accessToken,
      refreshToken:
        refreshed.refreshToken ?? (typeof existingOauth.refreshToken === "string" ? existingOauth.refreshToken : null),
      expiresAt: now + refreshed.expiresIn * 1000,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
