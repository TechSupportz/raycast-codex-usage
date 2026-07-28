import type { Account, UsageWindow } from "./types";

/** Parses codex-auth v0.2's fixed-column table. Unknown columns are ignored. */
export function parseCodexAuthTable(raw: string): Account[] {
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.includes("ACCOUNT") && line.includes("5H USAGE"));

  if (headerIndex === -1) {
    return [];
  }

  const header = lines[headerIndex];
  const planAt = header.indexOf("PLAN");
  const fiveHourAt = header.indexOf("5H USAGE");
  const weeklyAt = header.indexOf("WEEKLY USAGE");
  const activityAt = header.indexOf("LAST ACTIVITY");

  if ([planAt, fiveHourAt, weeklyAt, activityAt].some((index) => index === -1)) {
    return [];
  }

  return lines.slice(headerIndex + 2).flatMap((line) => {
    const identity = line
      .slice(0, planAt)
      .trim()
      .match(/^(\*)?\s*(\d+)\s+(\S+)$/);

    if (!identity) {
      return [];
    }

    const isCurrent = identity[1] === "*";
    const selector = identity[2];
    const email = identity[3];
    const plan = line.slice(planAt, fiveHourAt).trim() || null;
    const windows = [
      parseUsageWindow(line.slice(fiveHourAt, weeklyAt), "5h", "5h Limit"),
      parseUsageWindow(line.slice(weeklyAt, activityAt), "weekly", "Weekly Limit"),
    ].filter((window): window is UsageWindow => window !== null);

    return [account(selector, email, plan, windows, isCurrent)];
  });
}

export function applyCodexAuthRegistry(accounts: Account[], value: unknown): Account[] {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    return accounts;
  }

  const registryAccounts = value.accounts.filter(isRegistryAccount);
  const used = new Set<string>();
  const activeKey = typeof value.active_account_key === "string" ? value.active_account_key : null;
  const emailCounts = new Map<string, number>();

  for (const registry of registryAccounts) {
    emailCounts.set(registry.email, (emailCounts.get(registry.email) ?? 0) + 1);
  }

  return accounts.map((account) => {
    const registry = registryAccounts.find(
      (candidate) => candidate.email === account.email && !used.has(candidate.account_key),
    );

    if (!registry) {
      return account;
    }

    used.add(registry.account_key);
    const usage = isRecord(registry.last_usage) ? registry.last_usage : {};

    return {
      ...account,
      id: `codex-auth:${registry.account_key}`,
      plan:
        typeof usage.plan_type === "string"
          ? usage.plan_type
          : typeof registry.plan === "string"
            ? registry.plan
            : account.plan,
      windows: [toRegistryWindow(usage.primary), toRegistryWindow(usage.secondary)].filter(
        (window): window is UsageWindow => window !== null,
      ),
      isCurrent: registry.account_key === activeKey,
      switchQuery: emailCounts.get(registry.email) === 1 ? registry.email : account.switchQuery,
    };
  });
}

function parseUsageWindow(cell: string, id: string, label: string): UsageWindow | null {
  const remaining = cell.match(/(\d+(?:\.\d+)?)%/);

  if (!remaining) {
    return null;
  }

  return {
    id,
    label,
    usedPercent: 100 - Number(remaining[1]),
    // ponytail: v0.2 prints locale-formatted reset text; add parsing when exact reset timestamps matter.
    resetsAt: null,
  };
}

function toRegistryWindow(value: unknown): UsageWindow | null {
  if (!isRecord(value) || typeof value.used_percent !== "number" || typeof value.window_minutes !== "number") {
    return null;
  }

  return {
    id: `${value.window_minutes}`,
    label:
      value.window_minutes === 300
        ? "5h Limit"
        : value.window_minutes === 10080
          ? "Weekly Limit"
          : `${formatDuration(value.window_minutes)} Limit`,
    usedPercent: value.used_percent,
    resetsAt: typeof value.resets_at === "number" ? value.resets_at * 1000 : null,
  };
}

function formatDuration(minutes: number): string {
  return minutes >= 1440 ? `${Math.round(minutes / 1440)}d` : `${Math.round(minutes / 60)}h`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RegistryAccount = {
  account_key: string;
  email: string;
  plan?: string;
  last_usage?: unknown;
};

function isRegistryAccount(value: unknown): value is RegistryAccount {
  return (
    isRecord(value) &&
    typeof value.account_key === "string" &&
    typeof value.email === "string" &&
    (value.plan == null || typeof value.plan === "string")
  );
}

function account(
  selector: string,
  email: string,
  plan: string | null,
  windows: UsageWindow[],
  isCurrent: boolean,
): Account {
  return {
    id: `codex-auth:${selector}:${email}`,
    provider: "codex",
    label: email,
    plan,
    email,
    windows,
    resets: null,
    failure: null,
    isCurrent,
    switchQuery: selector,
  };
}
