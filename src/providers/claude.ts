import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isRecord, type Account, type UsageWindow } from "./types";

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const HTTP_TIMEOUT_MS = 10000;
const REFRESH_TIMEOUT_MS = 20000;
const USER_AGENT = "raycast-ai-usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CREDENTIALS_FILE = join(homedir(), ".claude/.credentials.json");

const CLAUDE_EXECUTABLE_CANDIDATES = [
  join(homedir(), ".claude/local/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  join(homedir(), ".local/bin/claude"),
  "claude",
];

type Credentials = {
  accessToken: string;
  expiresAt: number | null;
  subscriptionType: string | null;
};

export async function fetchClaudeAccount(): Promise<Account> {
  const base: Account = {
    id: "claude",
    label: "Claude Code",
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: null,
  };

  let credentials = readCredentials();

  if (!credentials) {
    return { ...base, failure: { kind: "expired", message: "Not signed in to Claude Code. Run `claude`." } };
  }

  // Anthropic rotates the refresh token on every use, so a refresh we performed
  // ourselves would invalidate the copy the CLI holds and force a re-login.
  // We only ever ask the CLI to refresh, then re-read what it stored.
  if (isExpired(credentials)) {
    await delegateRefresh();
    credentials = readCredentials() ?? credentials;
  }

  base.plan = credentials.subscriptionType;

  if (isExpired(credentials)) {
    return { ...base, failure: { kind: "expired", message: "Claude Code token expired. Run `claude` to refresh." } };
  }

  try {
    return { ...base, windows: await fetchWindows(credentials.accessToken) };
  } catch (error) {
    return { ...base, failure: { kind: "error", message: error instanceof Error ? error.message : String(error) } };
  }
}

function isExpired({ expiresAt }: Credentials): boolean {
  return expiresAt !== null && expiresAt <= Date.now();
}

/**
 * Nudges the Claude CLI into refreshing its own credentials. Failures are
 * swallowed: we re-check expiry afterwards and report that instead.
 */
async function delegateRefresh(): Promise<void> {
  try {
    await execFileAsync(resolveClaudeExecutable(), ["auth", "status"], {
      timeout: REFRESH_TIMEOUT_MS,
      env: { ...process.env, PATH: getExtendedPath() },
    });
  } catch {
    // Ignored on purpose - see above.
  }
}

function readCredentials(): Credentials | null {
  return parseCredentials(readKeychain() ?? readCredentialsFile());
}

function readKeychain(): string | null {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

function readCredentialsFile(): string | null {
  try {
    return existsSync(CREDENTIALS_FILE) ? readFileSync(CREDENTIALS_FILE, "utf8") : null;
  } catch {
    return null;
  }
}

function parseCredentials(raw: string | null): Credentials | null {
  if (!raw) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const oauth = isRecord(payload) && isRecord(payload.claudeAiOauth) ? payload.claudeAiOauth : null;

  if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken) {
    return null;
  }

  return {
    accessToken: oauth.accessToken,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
  };
}

async function fetchWindows(token: string): Promise<UsageWindow[]> {
  const response = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Claude usage returned HTTP ${response.status}.`);
  }

  const payload = await response.json();

  if (!isRecord(payload) || !Array.isArray(payload.limits)) {
    throw new Error("Claude returned an unexpected usage response.");
  }

  // The top level carries feature-flagged keys that come and go; `limits` is
  // already normalised, so new limit kinds show up here without a code change.
  return payload.limits.filter(isRecord).flatMap((limit) => {
    if (typeof limit.percent !== "number" || typeof limit.kind !== "string") {
      return [];
    }

    return [
      {
        id: limit.kind,
        label: formatLimitLabel(limit.kind),
        usedPercent: limit.percent,
        resetsAt: typeof limit.resets_at === "string" ? Date.parse(limit.resets_at) || null : null,
      },
    ];
  });
}

function formatLimitLabel(kind: string): string {
  if (kind === "session") {
    return "Session Limit";
  }

  if (kind === "weekly_all") {
    return "Weekly Limit";
  }

  const label = kind
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return label.endsWith("Limit") ? label : `${label} Limit`;
}

function resolveClaudeExecutable(): string {
  for (const candidate of CLAUDE_EXECUTABLE_CANDIDATES) {
    if (candidate !== "claude" && existsSync(candidate)) {
      return candidate;
    }
  }

  return "claude";
}

function getExtendedPath(): string {
  return [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(homedir(), ".local/bin"),
    join(homedir(), ".claude/local"),
  ]
    .filter(Boolean)
    .join(":");
}
