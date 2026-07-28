import { getPreferenceValues } from "@raycast/api";
import { CLAUDE_ACCOUNT_ID, fetchClaudeAccount } from "./providers/claude";
import { fetchCodexAccount, getCodexAccounts } from "./providers/codex";
import type { Account, ProviderId } from "./providers/types";

type Preferences = {
  showClaudeCode: boolean;
};

/**
 * How long a cached response is served without asking the provider again. Long
 * enough that opening and closing the command in quick succession costs one
 * request, short enough that the numbers are never meaningfully behind.
 *
 * Worth knowing before shortening this: Anthropic's usage endpoint rate-limits
 * by IP, and its 429 came back with `retry-after: 3164` - tripping it locks the
 * account out for the better part of an hour.
 */
const REFRESH_INTERVAL_MS: Record<ProviderId, number> = {
  claude: 60 * 1000,
  codex: 60 * 1000,
};

/**
 * Everything we know about an account before talking to the network, which is
 * enough to draw the list. The view renders these immediately and fills each
 * one in as its `fetch` resolves.
 */
export type ConfiguredAccount = {
  id: string;
  provider: ProviderId;
  label: string;
  /** Age at which this account's cached response is worth replacing. */
  refreshIntervalMs: number;
  fetch: () => Promise<Account>;
};

export function getConfiguredAccounts(): ConfiguredAccount[] {
  const { showClaudeCode } = getPreferenceValues<Preferences>();

  const accounts: ConfiguredAccount[] = getCodexAccounts().map((account) => ({
    id: account.id,
    provider: "codex",
    label: account.email ?? account.label,
    refreshIntervalMs: REFRESH_INTERVAL_MS.codex,
    fetch: account.failure ? async () => account : () => fetchCodexAccount(account.id),
  }));

  if (showClaudeCode) {
    accounts.push({
      id: CLAUDE_ACCOUNT_ID,
      provider: "claude",
      label: "Claude Code",
      refreshIntervalMs: REFRESH_INTERVAL_MS.claude,
      fetch: fetchClaudeAccount,
    });
  }

  return accounts;
}
