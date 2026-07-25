import { Cache } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccountNames } from "./account-names";
import { getConfiguredAccounts, type ConfiguredAccount } from "./usage";
import type { Account, AccountFailure, ProviderId } from "./providers/types";

const cache = new Cache();
const CACHE_KEY = "accounts";

/** A cached response, when we last asked, and when its usage last actually moved. */
type CacheEntry = {
  account: Account;
  /** When these numbers arrived. Drives the "Updated" line, so failures never touch it. */
  fetchedAt: number;
  /** When we last called the provider at all, successfully or not. Gates refetching. */
  attemptedAt: number;
  changedAt: number;
};

export type AccountState = {
  /** `label` already carries the user's rename, if they set one. */
  config: ConfiguredAccount;
  /** The label this account was configured with, shown as the rename form's fallback. */
  configuredLabel: string;
  /** Null until this account's first response arrives. */
  account: Account | null;
  /** True while `account` is a cached value we are still refreshing. */
  isStale: boolean;
  /** When this account's response was fetched, cached or otherwise. */
  fetchedAt: number | null;
  /** Set when a refresh failed but we still have good numbers to show. */
  refreshError: AccountFailure | null;
};

/**
 * Loads every configured account independently, so a slow provider never holds
 * up the ones that already answered. The last good response is cached and shown
 * straight away, which means the list is almost never empty on open.
 *
 * A cached response younger than its provider's refresh interval is served
 * without asking again - `refresh` ignores that and always refetches.
 */
export function useAccounts() {
  const configs = useMemo(getConfiguredAccounts, []);
  const { names, rename } = useAccountNames();
  // Read once, on the first render: the selection has to be right immediately,
  // because moving it later is what makes the list jump under the cursor.
  const [initial] = useState(() => {
    const entries = readCache(configs);

    return { entries, selectedId: getMostRecentlyUsed(entries) ?? configs[0]?.id };
  });
  const [entries, setEntries] = useState<Map<string, CacheEntry>>(initial.entries);
  const [refreshErrors, setRefreshErrors] = useState<Map<string, AccountFailure>>(new Map());
  const [pending, setPending] = useState<Set<string>>(() => new Set(configs.map((config) => config.id)));
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const latestRun = useRef(0);

  useEffect(() => {
    const run = ++latestRun.current;
    // Only the first pass honours the cache; every later pass is a deliberate
    // refresh, and `initial.entries` is what the cache held when we mounted.
    const due =
      refreshGeneration === 0 ? configs.filter((config) => !isFresh(initial.entries.get(config.id), config)) : configs;

    setPending(new Set(due.map((config) => config.id)));

    // Providers run side by side, but accounts within one provider go in turn:
    // ChatGPT's backend answers `{"error":"Too many concurrent requests"}` when
    // several arrive together, and each Codex check also costs a CLI spawn.
    for (const group of groupByProvider(due).values()) {
      void (async () => {
        for (const config of group) {
          const account = await config.fetch().catch((error: unknown) => failedAccount(config, error));

          if (latestRun.current !== run) {
            return;
          }

          const seenAt = Date.now();

          setEntries((previous) => {
            const before = previous.get(config.id);
            const next = new Map(previous);

            // A failed refresh must not throw away numbers we already have -
            // being rate limited for an hour should not blank the pane. We
            // still record the attempt, so we do not retry in a tight loop.
            if (account.failure && before && !before.account.failure) {
              return next.set(config.id, { ...before, attemptedAt: seenAt });
            }

            // Same usage as last time keeps the original timestamp, so
            // `changedAt` marks real movement rather than the last poll.
            const changedAt = before && signature(before.account) === signature(account) ? before.changedAt : seenAt;

            return next.set(config.id, { account, fetchedAt: seenAt, attemptedAt: seenAt, changedAt });
          });

          setRefreshErrors((previous) => {
            const next = new Map(previous);

            if (account.failure) {
              next.set(config.id, account.failure);
            } else {
              next.delete(config.id);
            }

            return next;
          });

          setPending((previous) => {
            const next = new Set(previous);
            next.delete(config.id);
            return next;
          });
        }
      })();
    }
  }, [configs, refreshGeneration, initial.entries]);

  useEffect(() => {
    if (pending.size === 0 && entries.size > 0) {
      writeCache(entries);
    }
  }, [pending, entries]);

  const states: AccountState[] = configs.map((config) => {
    const entry = entries.get(config.id);
    const failure = refreshErrors.get(config.id) ?? null;
    const name = names[config.id];

    return {
      config: name ? { ...config, label: name } : config,
      configuredLabel: config.label,
      account: entry?.account ?? null,
      isStale: pending.has(config.id) && entries.has(config.id),
      fetchedAt: entry?.fetchedAt ?? null,
      // Only worth reporting separately when the row still has usage to show;
      // otherwise the account itself already carries the failure.
      refreshError: entry && !entry.account.failure ? failure : null,
    };
  });

  return {
    states,
    isLoading: pending.size > 0,
    /** The account used most recently as of the last launch; stable for this session. */
    initialSelectedId: initial.selectedId,
    refresh: useCallback(() => setRefreshGeneration((value) => value + 1), []),
    /** Stores a display name for an account; an empty name restores the configured one. */
    rename,
  };
}

/** Groups the accounts due for a fetch by provider, preserving configured order. */
function groupByProvider(configs: ConfiguredAccount[]): Map<ProviderId, ConfiguredAccount[]> {
  const groups = new Map<ProviderId, ConfiguredAccount[]>();

  for (const config of configs) {
    const group = groups.get(config.provider);

    if (group) {
      group.push(config);
    } else {
      groups.set(config.provider, [config]);
    }
  }

  return groups;
}

function isFresh(entry: CacheEntry | undefined, config: ConfiguredAccount): boolean {
  return entry !== undefined && Date.now() - entry.attemptedAt < config.refreshIntervalMs;
}

/** The cached account whose usage moved most recently, if we have a baseline. */
function getMostRecentlyUsed(entries: Map<string, CacheEntry>): string | undefined {
  let latest: CacheEntry | null = null;

  for (const entry of entries.values()) {
    if (!latest || entry.changedAt > latest.changedAt) {
      latest = entry;
    }
  }

  return latest?.account.id;
}

/**
 * What counts as a change: how much of each window is spent, and nothing else.
 * Reset timestamps drift on their own and would make every poll look like use.
 */
function signature(account: Account): string {
  return JSON.stringify(account.windows.map((window) => [window.id, window.usedPercent]));
}

function failedAccount(config: ConfiguredAccount, error: unknown): Account {
  return {
    id: config.id,
    provider: config.provider,
    label: config.label,
    plan: null,
    email: null,
    windows: [],
    resets: null,
    failure: { kind: "error", message: error instanceof Error ? error.message : String(error) },
  };
}

function readCache(configs: ConfiguredAccount[]): Map<string, CacheEntry> {
  const raw = cache.get(CACHE_KEY);

  if (!raw) {
    return new Map();
  }

  const wanted = new Set(configs.map((config) => config.id));

  try {
    const entries = JSON.parse(raw) as CacheEntry[];

    // Cached entries whose account is no longer configured are dropped rather
    // than shown, and a stale failure is worse than no row at all.
    return new Map(
      entries
        .filter((entry) => entry?.account?.id && wanted.has(entry.account.id) && !entry.account.failure)
        .map((entry) => [entry.account.id, entry]),
    );
  } catch {
    return new Map();
  }
}

function writeCache(entries: Map<string, CacheEntry>) {
  cache.set(CACHE_KEY, JSON.stringify([...entries.values()]));
}
