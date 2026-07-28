# AI Usage

Raycast extension for checking your Codex and Claude Code usage limits from the command palette.

## What it shows

For each account, one section listing whichever rate-limit windows the provider reports:

- **Codex** — the 5-hour and weekly limits; `CODEX_HOME` mode also shows exact reset times and banked usage resets
- **Claude Code** — the session and weekly limits

Every window shows how much you have left, coloured by how close you are to the limit. Exact reset times appear when the selected source provides machine-readable timestamps.

## Multiple Codex accounts

By default, Codex accounts are read from configured `CODEX_HOME` directories. To use `codex-auth`, install it first:

```bash
npm install -g @loongphy/codex-auth
# or
bun add -g @loongphy/codex-auth
```

Then select `codex-auth` under **Codex Account Source**. Every stored account appears automatically. Use **Rename Account** in Raycast to give an email a shorter display name.

In extension preferences, choose one **Codex Account Source**:

- `codex-auth` discovers every managed account and enables switching.
- `CODEX_HOME` reads only the configured directories.

Sources are exclusive, so the same account is never shown twice.

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- For Codex limits: Codex CLI credentials in configured `CODEX_HOME` directories, or [codex-auth](https://github.com/loongphy/codex-auth) installed globally with npm or Bun
- For Claude Code limits: [Claude Code](https://claude.com/claude-code) installed and signed in

## Credentials

Codex credentials stay owned by the selected CLI: Codex CLI for `CODEX_HOME`, or `codex-auth` for managed accounts. Claude Code is refreshed directly using its stored OAuth refresh token, without making an inference request. The extension coordinates with Claude Code's refresh lock, re-reads credentials after acquiring it, and saves rotated credentials back to the same source before using them.

Claude Code credentials are read from the macOS Keychain, falling back to `~/.claude/.credentials.json`.

## Usage

1. Install the extension in Raycast.
2. Run `View AI Usage`.
3. Review your limits. `⌘R` refreshes.

## Troubleshooting

**A CODEX_HOME account is missing** — confirm its configured directory contains `auth.json`. Sign in with `CODEX_HOME=~/.codex-work codex login`.

**A codex-auth account is missing** — confirm it appears in `codex-auth list`.

**codex-auth will not load** — confirm `codex-auth list` works in Terminal, or reinstall it using one of the commands above.

## Development

```bash
npm install
npm run dev
```

## License

MIT
