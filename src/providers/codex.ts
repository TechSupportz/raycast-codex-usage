import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isRecord, type Account, type ResetCredit, type ResetCreditsResponse, type UsageWindow } from "./types";
import { parseResetExpiry } from "../reset-expiry";

const AUTH_TIMEOUT_MS = 20000;
const HTTP_TIMEOUT_MS = 10000;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const USER_AGENT = "raycast-ai-usage";

const CODEX_EXECUTABLE_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "/usr/bin/codex",
  join(homedir(), ".local/bin/codex"),
  join(homedir(), ".npm-global/bin/codex"),
  "codex",
];

export type CodexAccountConfig = {
  label: string;
  home: string;
};

/**
 * Parses the account-paths preference. Each entry is either a bare path or
 * `Label=path`; without an explicit label we derive one from the directory
 * name, so `~/.codex` reads as "Personal" and `~/.codex-nus` as "Nus".
 */
export function parseAccountPaths(raw: string): CodexAccountConfig[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      const label = separator === -1 ? null : entry.slice(0, separator).trim();
      const path = separator === -1 ? entry : entry.slice(separator + 1).trim();
      const home = expandHome(path);

      return { label: label || deriveLabel(home), home };
    })
    .filter((config) => config.home.length > 0);
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }

  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function deriveLabel(home: string): string {
  const suffix = basename(home)
    .replace(/^\.?codex/i, "")
    .replace(/^[-_]/, "");

  if (!suffix) {
    return "Personal";
  }

  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

export function codexAccountId(home: string): string {
  return `codex:${home}`;
}

export async function fetchCodexAccount(config: CodexAccountConfig): Promise<Account> {
  const base: Account = {
    id: codexAccountId(config.home),
    provider: "codex",
    label: config.label,
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: null,
  };

  if (!existsSync(join(config.home, "auth.json"))) {
    return { ...base, failure: { kind: "expired", message: `No credentials in ${config.home}. Run \`codex login\`.` } };
  }

  let token: string;

  try {
    // The CLI owns these credentials, so we ask it to refresh rather than
    // spending the refresh token ourselves and desyncing its stored copy.
    token = await readAuthToken(config.home);
  } catch (error) {
    return { ...base, failure: { kind: "expired", message: describe(error) } };
  }

  const accountId = getChatGptAccountId(token);

  try {
    const usage = await fetchUsage(token, accountId);
    const account = { ...base, ...usage };

    // Only the account that actually has resets pays for the second call.
    if (usage.resetCount > 0) {
      account.resets = await fetchResetCredits(token, accountId).catch(() => null);
    }

    return account;
  } catch (error) {
    return { ...base, failure: { kind: "error", message: describe(error) } };
  }
}

/** Spawns `codex app-server` under the given CODEX_HOME purely to get a fresh token. */
function readAuthToken(codexHome: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCodexExecutable(), ["app-server"], {
      env: { ...process.env, CODEX_HOME: codexHome, PATH: getExtendedPath() },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(
      () => finish(new Error("Timed out waiting for Codex to report auth status.")),
      AUTH_TIMEOUT_MS,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        handleLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        finish(
          new Error(
            `Could not find the Codex CLI. Checked: ${CODEX_EXECUTABLE_CANDIDATES.join(", ")}. Install Codex or add it to a standard PATH location.`,
          ),
        );
        return;
      }

      finish(error);
    });

    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish(new Error(`Codex app-server exited with code ${code}.${formatStderr(stderr)}`));
      }
    });

    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: USER_AGENT, version: "1.0.0" } },
      }) + "\n",
    );

    function handleLine(line: string) {
      let message: { id?: number; result?: unknown; error?: { message?: string } };

      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        child.stdin.write(
          JSON.stringify({
            id: 2,
            method: "getAuthStatus",
            params: { includeToken: true, refreshToken: true },
          }) + "\n",
        );
        return;
      }

      if (message.id !== 2) {
        return;
      }

      if (message.error) {
        finish(new Error(`${message.error.message ?? "Codex could not report auth status"}.${formatStderr(stderr)}`));
        return;
      }

      const token = isRecord(message.result) ? message.result.authToken : null;

      if (typeof token !== "string" || !token) {
        finish(new Error("Codex is not signed in. Run `codex login`."));
        return;
      }

      finish(null, token);
    }

    function finish(error: Error | null, token?: string) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      child.kill();

      if (error) {
        reject(error);
        return;
      }

      resolve(token as string);
    }
  });
}

type UsageResult = {
  plan: string | null;
  email: string | null;
  windows: UsageWindow[];
  resetCount: number;
};

async function fetchUsage(token: string, accountId: string | null): Promise<UsageResult> {
  const payload = await getJson(USAGE_URL, token, accountId);

  if (!isRecord(payload)) {
    throw new Error("Codex returned an unexpected usage response.");
  }

  const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : {};
  const resetCredits = isRecord(payload.rate_limit_reset_credits) ? payload.rate_limit_reset_credits : {};

  return {
    plan: typeof payload.plan_type === "string" ? payload.plan_type : null,
    email: typeof payload.email === "string" ? payload.email : null,
    windows: [toWindow(rateLimit.primary_window, "primary"), toWindow(rateLimit.secondary_window, "secondary")].filter(
      (window): window is UsageWindow => window !== null,
    ),
    resetCount: typeof resetCredits.available_count === "number" ? resetCredits.available_count : 0,
  };
}

function toWindow(value: unknown, id: string): UsageWindow | null {
  if (!isRecord(value) || typeof value.used_percent !== "number") {
    return null;
  }

  const seconds = typeof value.limit_window_seconds === "number" ? value.limit_window_seconds : null;

  return {
    id: seconds ? `${seconds}` : id,
    label: formatWindowLabel(seconds),
    usedPercent: value.used_percent,
    resetsAt: typeof value.reset_at === "number" ? value.reset_at * 1000 : null,
  };
}

function formatWindowLabel(seconds: number | null): string {
  if (seconds === null) {
    return "Limit";
  }

  if (seconds === 18000) {
    return "5h Limit";
  }

  if (seconds === 604800) {
    return "Weekly Limit";
  }

  const hours = Math.round(seconds / 3600);

  return hours >= 24 ? `${Math.round(hours / 24)}d Limit` : `${hours}h Limit`;
}

async function fetchResetCredits(token: string, accountId: string | null): Promise<ResetCreditsResponse> {
  const payload = await getJson(RESET_CREDITS_URL, token, accountId);

  if (!isRecord(payload) || !Array.isArray(payload.credits)) {
    throw new Error("Codex returned an invalid reset-credit response.");
  }

  const credits = payload.credits.filter(isResetCredit);

  return { credits, available_count: credits.filter((credit) => credit.status === "available").length };
}

function isResetCredit(value: unknown): value is ResetCredit {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.granted_at === "string" &&
    Number.isFinite(parseResetExpiry(value.granted_at)) &&
    typeof value.expires_at === "string" &&
    Number.isFinite(parseResetExpiry(value.expires_at)) &&
    (value.title == null || typeof value.title === "string") &&
    (value.description == null || typeof value.description === "string")
  );
}

async function getJson(url: string, token: string, accountId: string | null): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "OpenAI-Beta": "codex-1",
    originator: "codex_cli_rs",
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`Codex usage returned HTTP ${response.status}.`);
  }

  return response.json();
}

function getChatGptAccountId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };

    return payload["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

function resolveCodexExecutable(): string {
  for (const candidate of CODEX_EXECUTABLE_CANDIDATES) {
    if (candidate !== "codex" && existsSync(candidate)) {
      return candidate;
    }
  }

  return "codex";
}

function getExtendedPath(): string {
  return [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(homedir(), ".local/bin"),
    join(homedir(), ".npm-global/bin"),
  ]
    .filter(Boolean)
    .join(":");
}

function formatStderr(stderr: string): string {
  const meaningfulLine = stderr
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("WARNING:"));

  return meaningfulLine ? ` ${meaningfulLine}` : "";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
