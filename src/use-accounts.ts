import { Cache } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConfiguredAccounts, type ConfiguredAccount } from "./usage";
import type { Account } from "./providers/types";

const cache = new Cache();
const CACHE_KEY = "accounts";

/** A cached response plus when its usage numbers last actually moved. */
type CacheEntry = {
  account: Account;
  changedAt: number;
};

export type AccountState = {
  config: ConfiguredAccount;
  /** Null until this account's first response arrives. */
  account: Account | null;
  /** True while `account` is a cached value we are still refreshing. */
  isStale: boolean;
};

/**
 * Loads every configured account independently, so a slow provider never holds
 * up the ones that already answered. The last good response is cached and shown
 * straight away, which means the list is almost never empty on open.
 */
export function useAccounts() {
  const configs = useMemo(getConfiguredAccounts, []);
  // Read once, on the first render: the selection has to be right immediately,
  // because moving it later is what makes the list jump under the cursor.
  const [initial] = useState(() => {
    const entries = readCache(configs);

    return { entries, selectedId: getMostRecentlyUsed(entries) ?? configs[0]?.id };
  });
  const [entries, setEntries] = useState<Map<string, CacheEntry>>(initial.entries);
  const [pending, setPending] = useState<Set<string>>(() => new Set(configs.map((config) => config.id)));
  const [nonce, setNonce] = useState(0);
  const latestRun = useRef(0);

  useEffect(() => {
    const run = ++latestRun.current;
    setPending(new Set(configs.map((config) => config.id)));

    for (const config of configs) {
      config
        .fetch()
        .catch((error: unknown) => failedAccount(config, error))
        .then((account) => {
          if (latestRun.current !== run) {
            return;
          }

          const seenAt = Date.now();

          setEntries((previous) => {
            const before = previous.get(config.id);
            // Same usage as last time keeps the original timestamp, so
            // `changedAt` marks real movement rather than the last poll.
            const changedAt = before && signature(before.account) === signature(account) ? before.changedAt : seenAt;

            return new Map(previous).set(config.id, { account, changedAt });
          });

          setPending((previous) => {
            const next = new Set(previous);
            next.delete(config.id);
            return next;
          });
        });
    }
  }, [configs, nonce]);

  useEffect(() => {
    if (pending.size === 0 && entries.size > 0) {
      writeCache(entries);
    }
  }, [pending, entries]);

  const states: AccountState[] = configs.map((config) => ({
    config,
    account: entries.get(config.id)?.account ?? null,
    isStale: pending.has(config.id) && entries.has(config.id),
  }));

  return {
    states,
    isLoading: pending.size > 0,
    /** The account used most recently as of the last launch; stable for this session. */
    initialSelectedId: initial.selectedId,
    refresh: useCallback(() => setNonce((value) => value + 1), []),
  };
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
