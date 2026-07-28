import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { buildCliPath } from "./cli";
import { applyCodexAuthRegistry, parseCodexAuthTable } from "./codex-auth-table";
import { fetchCodexResetCredits } from "./codex-reset-credits";
import { isRecord } from "./types";
import type { Account } from "./types";

const execFileAsync = promisify(execFile);
const CACHE_MS = 10_000;
const INSTALL_MESSAGE =
  "codex-auth not found. Install it with `npm install -g @loongphy/codex-auth` or `bun add -g @loongphy/codex-auth`.";

let cached: { at: number; accounts: Promise<Account[]> } | null = null;

/** Fast local-only discovery used to create one Raycast row per stored account. */
export function getCodexAccounts(): Account[] {
  try {
    const command = resolveCodexAuthCommand();
    const output = execFileSync(command.file, [...command.prefix, "list", "--skip-api"], {
      encoding: "utf8",
      timeout: 5_000,
      env: command.env,
    });

    return parseAccounts(output);
  } catch (error) {
    return [unavailableAccount(error)];
  }
}

export async function fetchCodexAccount(id: string): Promise<Account> {
  const base = emptyAccount(id);

  try {
    const accounts = await listCodexAccounts();
    return (
      accounts.find((candidate) => candidate.id === id) ?? {
        ...base,
        failure: { kind: "expired", message: "codex-auth no longer lists this account." },
      }
    );
  } catch (error) {
    return {
      ...base,
      failure: { kind: "error", message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function switchCodexAccount(query: string, expectedId: string): Promise<void> {
  const command = resolveCodexAuthCommand();
  const wasRunning = await isChatGptRunning();

  try {
    await execFileAsync(command.file, [...command.prefix, "switch", query], {
      timeout: 30_000,
      env: command.env,
    });
  } catch (error) {
    throw new Error(commandErrorMessage(error));
  }

  const expectedKey = expectedId.startsWith("codex-auth:") ? expectedId.slice("codex-auth:".length) : null;
  const registry = readRegistry();
  const activeKey = isRecord(registry) ? registry.active_account_key : null;

  if (expectedKey && activeKey !== expectedKey) {
    throw new Error("codex-auth did not activate the selected account.");
  }

  cached = null;

  if (wasRunning) {
    await execFileAsync("/usr/bin/pkill", ["-KILL", "-f", "^/Applications/ChatGPT\\.app/Contents/"]).catch(
      () => undefined,
    );

    for (let attempt = 0; attempt < 100 && (await isChatGptRunning()); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (await isChatGptRunning()) {
      throw new Error("Account switched, but Codex did not finish quitting. Reopen it manually.");
    }

    try {
      await execFileAsync("/usr/bin/open", ["-b", "com.openai.codex"]);
    } catch {
      throw new Error("Account switched, but Codex could not reopen. Reopen it manually.");
    }
  }
}

function commandErrorMessage(error: unknown): string {
  if (!isRecord(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
  const message = error instanceof Error ? error.message : "codex-auth could not switch accounts.";

  return stderr || stdout || message;
}

function emptyAccount(id: string): Account {
  return {
    id,
    provider: "codex",
    label: "Codex",
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: null,
  };
}

function listCodexAccounts(): Promise<Account[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.accounts;
  }

  const command = resolveCodexAuthCommand();
  const accounts = execFileAsync(command.file, [...command.prefix, "list"], {
    encoding: "utf8",
    timeout: 30_000,
    env: command.env,
  }).then(async ({ stdout }) => addResetCredits(parseAccounts(stdout)));

  cached = { at: Date.now(), accounts };
  return accounts;
}

function parseAccounts(output: string): Account[] {
  return applyCodexAuthRegistry(parseCodexAuthTable(output), readRegistry());
}

function readRegistry(): unknown {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".codex/accounts/registry.json"), "utf8"));
  } catch {
    return null;
  }
}

async function addResetCredits(accounts: Account[]): Promise<Account[]> {
  const result: Account[] = [];

  for (const account of accounts) {
    const accountKey = account.id.startsWith("codex-auth:") ? account.id.slice("codex-auth:".length) : null;

    if (!accountKey || accountKey === "unavailable") {
      result.push(account);
      continue;
    }

    try {
      const filename = `${Buffer.from(accountKey).toString("base64url")}.auth.json`;
      const auth: unknown = JSON.parse(readFileSync(join(homedir(), ".codex/accounts", filename), "utf8"));
      const tokens = isRecord(auth) && isRecord(auth.tokens) ? auth.tokens : {};
      const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : null;
      const accountId = typeof tokens.account_id === "string" ? tokens.account_id : null;

      result.push({
        ...account,
        resets: accessToken ? await fetchCodexResetCredits(accessToken, accountId).catch(() => null) : null,
      });
    } catch {
      result.push(account);
    }
  }

  return result;
}

async function isChatGptRunning(): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/pgrep", ["-f", "^/Applications/ChatGPT\\.app/Contents/"]);
    return true;
  } catch {
    return false;
  }
}

type CodexAuthCommand = {
  file: string;
  prefix: string[];
  env: NodeJS.ProcessEnv;
};

function resolveCodexAuthCommand(): CodexAuthCommand {
  const bun = join(homedir(), ".bun/bin/bun");
  const bunScript = join(homedir(), ".bun/bin/codex-auth");

  if (existsSync(bun) && existsSync(bunScript)) {
    return { file: bun, prefix: [bunScript], env: process.env };
  }

  const executable = [
    "/opt/homebrew/bin/codex-auth",
    "/usr/local/bin/codex-auth",
    join(homedir(), ".local/bin/codex-auth"),
    join(homedir(), ".npm-global/bin/codex-auth"),
    ...(process.env.PATH ?? "").split(":").map((directory) => join(directory, "codex-auth")),
  ].find(existsSync);

  if (!executable) {
    throw new Error(INSTALL_MESSAGE);
  }

  return {
    file: executable,
    prefix: [],
    env: { ...process.env, PATH: buildCliPath([dirname(executable)]) },
  };
}

function unavailableAccount(error: unknown): Account {
  return {
    id: "codex-auth:unavailable",
    provider: "codex",
    label: "codex-auth",
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: {
      kind: "error",
      message: error instanceof Error ? error.message : INSTALL_MESSAGE,
    },
  };
}
