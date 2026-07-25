import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseClaudeUsagePayload } from "./claude-usage";
import { buildCliPath, resolveExecutable } from "./cli";
import { isRecord, type Account, type UsageWindow } from "./types";

const execFileAsync = promisify(execFile);

export const CLAUDE_ACCOUNT_ID = "claude";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const HTTP_TIMEOUT_MS = 10000;
const REFRESH_TIMEOUT_MS = 20000;
const USER_AGENT = "raycast-ai-usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CREDENTIALS_FILE = join(homedir(), ".claude/.credentials.json");
const CLAUDE_EXTRA_PATHS = [join(homedir(), ".local/bin"), join(homedir(), ".claude/local")];

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
    id: CLAUDE_ACCOUNT_ID,
    provider: "claude",
    label: "Claude Code",
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: null,
  };

  let credentials = await readCredentials();

  if (!credentials) {
    return { ...base, failure: { kind: "expired", message: "Not signed in to Claude Code. Run `claude`." } };
  }

  // Anthropic rotates the refresh token on every use, so a refresh we performed
  // ourselves would invalidate the copy the CLI holds and force a re-login.
  // We only ever ask the CLI to refresh, then re-read what it stored.
  if (isExpired(credentials)) {
    await delegateRefresh();
    credentials = (await readCredentials()) ?? credentials;
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
    await execFileAsync(resolveExecutable(CLAUDE_EXECUTABLE_CANDIDATES, "claude"), ["auth", "status"], {
      timeout: REFRESH_TIMEOUT_MS,
      env: { ...process.env, PATH: buildCliPath(CLAUDE_EXTRA_PATHS) },
    });
  } catch {
    // Ignored on purpose - see above.
  }
}

async function readCredentials(): Promise<Credentials | null> {
  const keychainCredentials = parseCredentials(await readKeychain());

  return keychainCredentials ?? parseCredentials(await readCredentialsFile());
}

async function readKeychain(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    return stdout;
  } catch {
    return null;
  }
}

async function readCredentialsFile(): Promise<string | null> {
  try {
    return await readFile(CREDENTIALS_FILE, {
      encoding: "utf8",
    });
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

  return parseClaudeUsagePayload(payload);
}
