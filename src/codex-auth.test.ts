import assert from "node:assert/strict";
import test from "node:test";
import { applyCodexAuthRegistry, parseCodexAuthTable } from "./providers/codex-auth-table.ts";

test("parses every codex-auth account and converts remaining to used percent", () => {
  const output = `     ACCOUNT                 PLAN     5H USAGE              WEEKLY USAGE           LAST ACTIVITY
------------------------------------------------------------------------------------------------
  01 student@example.edu     Unknown  100% (16:44)          100% (11:44 on 4 Aug)  2m ago
* 02 personal@example.com    Plus     99% (11:37 on 4 Aug)  99% (11:37 on 4 Aug)   Now
`;

  const accounts = parseCodexAuthTable(output);

  assert.deepEqual(
    accounts.map(({ email, plan, windows, isCurrent, switchQuery }) => ({
      email,
      plan,
      used: windows.map((window) => window.usedPercent),
      isCurrent,
      switchQuery,
    })),
    [
      {
        email: "student@example.edu",
        plan: "Unknown",
        used: [0, 0],
        isCurrent: false,
        switchQuery: "01",
      },
      {
        email: "personal@example.com",
        plan: "Plus",
        used: [1, 1],
        isCurrent: true,
        switchQuery: "02",
      },
    ],
  );
});

test("keeps same-email profiles distinct", () => {
  const output = `     ACCOUNT                 PLAN  5H USAGE  WEEKLY USAGE  LAST ACTIVITY
--------------------------------------------------------------------------------
  01 same@example.com        Plus  90%       80%           1m ago
* 02 same@example.com        Team  70%       60%           Now
`;

  const accounts = applyCodexAuthRegistry(parseCodexAuthTable(output), {
    active_account_key: "account-2",
    accounts: [
      { account_key: "account-1", email: "same@example.com", plan: "plus", last_usage: {} },
      { account_key: "account-2", email: "same@example.com", plan: "team", last_usage: {} },
    ],
  });

  assert.equal(new Set(accounts.map(({ id }) => id)).size, 2);
  assert.deepEqual(
    accounts.map(({ switchQuery, isCurrent }) => ({ switchQuery, isCurrent })),
    [
      { switchQuery: "01", isCurrent: false },
      { switchQuery: "02", isCurrent: true },
    ],
  );
});

test("uses registry duration when a weekly-only account is repeated in both table columns", () => {
  const output = `     ACCOUNT              PLAN  5H USAGE  WEEKLY USAGE  LAST ACTIVITY
--------------------------------------------------------------------------------
* 01 weekly@example.com   Plus  93%       93%           Now
`;
  const registry = {
    active_account_key: "account-1",
    accounts: [
      {
        account_key: "account-1",
        email: "weekly@example.com",
        plan: "plus",
        last_usage: {
          primary: { used_percent: 7, window_minutes: 10080, resets_at: 1785814639 },
          secondary: null,
        },
      },
    ],
  };

  const [account] = applyCodexAuthRegistry(parseCodexAuthTable(output), registry);

  assert.deepEqual(account.windows, [
    {
      id: "10080",
      label: "Weekly Limit",
      usedPercent: 7,
      resetsAt: 1785814639000,
    },
  ]);
  assert.equal(account.switchQuery, "weekly@example.com");
});
