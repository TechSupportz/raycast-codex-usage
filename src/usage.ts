import { getPreferenceValues } from "@raycast/api";
import { fetchClaudeAccount } from "./providers/claude";
import { fetchCodexAccount, parseAccountPaths } from "./providers/codex";
import type { Account } from "./providers/types";

type Preferences = {
  codexAccountPaths: string;
  showClaudeCode: boolean;
};

/**
 * Fetches every configured account in parallel. Providers resolve rather than
 * reject, so one broken account never blanks the whole list.
 */
export async function fetchAllAccounts(): Promise<Account[]> {
  const { codexAccountPaths, showClaudeCode } = getPreferenceValues<Preferences>();
  const codexAccounts = parseAccountPaths(codexAccountPaths ?? "");

  const pending: Promise<Account>[] = codexAccounts.map(fetchCodexAccount);

  if (showClaudeCode) {
    pending.push(fetchClaudeAccount());
  }

  return Promise.all(pending);
}
