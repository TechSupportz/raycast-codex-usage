import { getPreferenceValues } from "@raycast/api";
import { CLAUDE_ACCOUNT_ID, fetchClaudeAccount } from "./providers/claude";
import { codexAccountId, fetchCodexAccount, parseAccountPaths } from "./providers/codex";
import type { Account, ProviderId } from "./providers/types";

type Preferences = {
  codexAccountPaths: string;
  showClaudeCode: boolean;
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
  fetch: () => Promise<Account>;
};

export function getConfiguredAccounts(): ConfiguredAccount[] {
  const { codexAccountPaths, showClaudeCode } = getPreferenceValues<Preferences>();

  const accounts: ConfiguredAccount[] = parseAccountPaths(codexAccountPaths ?? "").map((config) => ({
    id: codexAccountId(config.home),
    provider: "codex",
    label: config.label,
    fetch: () => fetchCodexAccount(config),
  }));

  if (showClaudeCode) {
    accounts.push({
      id: CLAUDE_ACCOUNT_ID,
      provider: "claude",
      label: "Claude Code",
      fetch: fetchClaudeAccount,
    });
  }

  return accounts;
}
