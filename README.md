# AI Usage

Raycast extension for checking your Codex and Claude Code usage limits from the command palette.

## What it shows

For each account, one section listing whichever rate-limit windows the provider reports:

- **Codex** — the 5-hour and weekly limits, plus banked usage resets
- **Claude Code** — the session and weekly limits

Every window shows how much you have left, coloured by how close you are to the limit. Exact reset times appear when `codex-auth` provides machine-readable timestamps.

## Multiple Codex accounts

Codex account discovery and switching require [codex-auth](https://github.com/loongphy/codex-auth). Install it globally with npm or Bun:

```bash
npm install -g @loongphy/codex-auth
# or
bun add -g @loongphy/codex-auth
```

Sign in to each account with `codex-auth`, then confirm they appear:

```bash
codex-auth login
codex-auth list
```

Every managed account appears automatically in Raycast. Use **Switch to This Account** to make one active, or **Rename Account** to give an email a shorter display name.

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- For Codex limits: [codex-auth](https://github.com/loongphy/codex-auth) installed globally with at least one signed-in account
- For Claude Code limits: [Claude Code](https://claude.com/claude-code) installed and signed in

## Credentials

Codex credentials stay owned by `codex-auth`. The extension reads its account registry and asks `codex-auth` to switch the active account. Claude Code is refreshed directly using its stored OAuth refresh token, without making an inference request. The extension coordinates with Claude Code's refresh lock, re-reads credentials after acquiring it, and saves rotated credentials back to the same source before using them.

Claude Code credentials are read from the macOS Keychain, falling back to `~/.claude/.credentials.json`.

## Usage

1. Install `codex-auth` and sign in to your Codex accounts.
2. Install the extension in Raycast.
3. Run `View AI Usage`.
4. Review your limits. `⌘R` refreshes.

## Troubleshooting

**A codex-auth account is missing** — confirm it appears in `codex-auth list`.

**codex-auth will not load** — confirm `codex-auth list` works in Terminal, or reinstall it using one of the commands above.

## Development

```bash
npm install
npm run dev
```

## License

MIT
