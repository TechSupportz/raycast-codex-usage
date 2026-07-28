import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildCliPath, resolveExecutable } from "./cli";
import type { CodexHomeConfig } from "./codex-home-paths";
import { fetchCodexResetCredits } from "./codex-reset-credits";
import { isRecord, type Account, type UsageWindow } from "./types";

const AUTH_TIMEOUT_MS = 20_000;
const HTTP_TIMEOUT_MS = 10_000;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USER_AGENT = "raycast-ai-usage";
const CODEX_PATHS = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/usr/bin/codex", "codex"];

export function codexHomeAccountId(home: string): string {
  return `codex-home:${home}`;
}

export async function fetchCodexHomeAccount(config: CodexHomeConfig): Promise<Account> {
  const base: Account = {
    id: codexHomeAccountId(config.home),
    provider: "codex",
    label: config.label,
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: null,
  };

  if (!existsSync(join(config.home, "auth.json"))) {
    return { ...base, failure: { kind: "expired", message: `No credentials in ${config.home}.` } };
  }

  try {
    const token = await readAuthToken(config.home);
    const payload = await getJson(USAGE_URL, token);

    if (!isRecord(payload)) {
      throw new Error("Codex returned an unexpected usage response.");
    }

    const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : {};
    const resetCredits = isRecord(payload.rate_limit_reset_credits) ? payload.rate_limit_reset_credits : {};
    const result: Account = {
      ...base,
      plan: typeof payload.plan_type === "string" ? payload.plan_type : null,
      email: typeof payload.email === "string" ? payload.email : null,
      windows: [
        toWindow(rateLimit.primary_window, "primary"),
        toWindow(rateLimit.secondary_window, "secondary"),
      ].filter((window): window is UsageWindow => window !== null),
    };

    if (typeof resetCredits.available_count === "number") {
      result.resets =
        resetCredits.available_count > 0
          ? await fetchCodexResetCredits(token, getChatGptAccountId(token)).catch(() => null)
          : { credits: [], available_count: 0 };
    }

    return result;
  } catch (error) {
    return {
      ...base,
      failure: { kind: "error", message: error instanceof Error ? error.message : String(error) },
    };
  }
}

function readAuthToken(codexHome: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveExecutable(CODEX_PATHS, "codex"), ["app-server"], {
      env: { ...process.env, CODEX_HOME: codexHome, PATH: buildCliPath([]) },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for Codex auth.")), AUTH_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        let message: { id?: number; result?: unknown; error?: { message?: string } };

        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.id === 1) {
          child.stdin.write(
            `${JSON.stringify({
              id: 2,
              method: "getAuthStatus",
              params: { includeToken: true, refreshToken: true },
            })}\n`,
          );
        } else if (message.id === 2) {
          const token = isRecord(message.result) ? message.result.authToken : null;
          finish(
            typeof token === "string" && token ? null : new Error(message.error?.message ?? "Codex is not signed in."),
            typeof token === "string" ? token : undefined,
          );
        }
      }
    });

    child.on("error", finish);
    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: USER_AGENT, version: "1.0.0" } },
      })}\n`,
    );

    function finish(error: Error | null, token?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();

      if (error) {
        reject(error);
      } else {
        resolve(token as string);
      }
    }
  });
}

async function getJson(url: string, token: string): Promise<unknown> {
  const accountId = getChatGptAccountId(token);
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

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

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

function toWindow(value: unknown, id: string): UsageWindow | null {
  if (!isRecord(value) || typeof value.used_percent !== "number") {
    return null;
  }

  const seconds = typeof value.limit_window_seconds === "number" ? value.limit_window_seconds : null;

  return {
    id,
    label: seconds === 18_000 ? "5h Limit" : seconds === 604_800 ? "Weekly Limit" : "Limit",
    usedPercent: value.used_percent,
    resetsAt: typeof value.reset_at === "number" ? value.reset_at * 1000 : null,
  };
}
