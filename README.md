# AI Usage

Raycast extension for checking your Codex and Claude Code usage limits from the command palette.

## What it shows

For each account, one section listing whichever rate-limit windows the provider reports:

- **Codex** — the 5-hour and weekly limits, plus banked usage resets with a detail view showing every reset's grant and expiry dates
- **Claude Code** — the session and weekly limits

Every window shows how much you have left, coloured by how close you are to the limit, and when it resets. Windows are rendered from whatever each API returns, so a limit that does not apply to your plan simply does not appear.

## Multiple Codex accounts

Codex keeps its credentials in `CODEX_HOME`, which defaults to `~/.codex`. If you keep a second account in another directory, add it in the extension's preferences under **Codex Account Paths** as a comma-separated list:

```
~/.codex, Work=~/.codex-work
```

Account names are derived from the directory (`~/.codex` becomes "Personal", `~/.codex-work` becomes "Work"), or you can set one explicitly with `Label=path`. The plan and email address come from the API, so nothing about your accounts is stored in this repository.

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- For Codex limits: the [Codex CLI](https://openai.com/codex) on your `PATH`, signed in with `codex login`
- For Claude Code limits: [Claude Code](https://claude.com/claude-code) installed and signed in

## Credentials

The extension never performs an OAuth token refresh itself. Both CLIs rotate their refresh tokens, so refreshing one behind its back would invalidate the copy it holds and force you to sign in again. Instead, this extension reads whatever token the CLI currently has and asks that CLI to refresh when the token has expired. If a refresh does not happen, the account is shown as signed out with a hint to run the CLI.

Claude Code credentials are read from the macOS Keychain, falling back to `~/.claude/.credentials.json`.

## Usage

1. Install the extension in Raycast.
2. Run `View AI Usage`.
3. Review your limits. `⌘R` refreshes.

## Troubleshooting

**An account shows "Signed Out"** — run `codex login` for that account, or `claude` for Claude Code. For a non-default Codex directory, set `CODEX_HOME` when logging in:

```bash
CODEX_HOME=~/.codex-work codex login
```

**An account is missing entirely** — check that its path is listed in **Codex Account Paths** and that the directory contains an `auth.json`.

**Codex will not load at all** — confirm `codex` runs in Terminal and is installed somewhere standard such as `/opt/homebrew/bin/codex`.

## Development

```bash
npm install
npm run dev
```

## License

MIT
