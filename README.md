# CodexResets

CodexResets shows your Codex usage limits, saved full-reset credits, and a suggested time to use the next credit.

> [!IMPORTANT]
> CodexResets is an independent community project, not an official OpenAI product. It uses undocumented ChatGPT endpoints that may change. Use `/usage` in the Codex TUI for the supported OpenAI experience.

## What it shows

- A decision-first recommendation to use, keep, or skip the next saved reset
- A chronological milestone list for the recommended action, natural resets, projected depletion, and the next credit expiry
- Five-hour and weekly limit status with remaining capacity, reset timing, pace confidence, and clear `ON TRACK` or `AT RISK` labels
- Saved full-reset credits ordered by expiry, with the next decision-relevant credit highlighted

CodexResets is read-only: it never consumes a reset credit.

## Requirements

- macOS or Linux
- Node.js 18 or newer and npm
- Bash and curl
- A current Codex CLI sign-in stored in `~/.codex/auth.json`

Credentials stored only in an operating-system keyring cannot be read by this tool.

## Install

Download and run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/maximpri/CodexResets/main/install.sh \
  -o codexresets-install.sh
bash codexresets-install.sh
codexresets
```

You can inspect `codexresets-install.sh` before running it and delete it afterward. The installer never uses `sudo` or edits your shell profile.

If the default npm location is not writable, install to your home directory:

```bash
CODEXRESETS_PREFIX="$HOME/.local" bash codexresets-install.sh
export PATH="$HOME/.local/bin:$PATH"
```

To update, download the installer again and rerun it. To uninstall:

```bash
npm uninstall --global codexresets
```

For a home-directory installation, add `--prefix "$HOME/.local"` to the uninstall command.

## Use

Run a report:

```bash
codexresets
```

The table is ordered for quick decisions:

1. **Decision** states what to do, when to do it, the expected reset value, and the credit deadline.
2. **Key milestones** puts the recommendation, limit resets, projected depletion, and next expiry on one timeline. `◆` marks the recommended action, `!` marks a risk or deadline, and `●` marks an informational checkpoint.
3. **Limit status** summarizes whether each active usage window should last until its natural reset.
4. **Saved resets** lists available credits by expiry and marks the next one as `NEXT`.

Times are shown in the selected local time zone. Relative durations such as `IN 3h 34m` make the next event easy to compare; use `--timezone` when planning in another location.

Common examples:

```bash
codexresets --timezone Europe/London
codexresets --format json
codexresets --record
codexresets --watch 15m --record
codexresets --watch 15m --record --notify
```

Useful options:

| Option | Purpose |
| --- | --- |
| `--timezone <name>` | Display dates in an IANA time zone such as `UTC`. |
| `--format <type>` | Choose `table` or `json` output. |
| `--record` | Save a sanitized usage snapshot for better forecasts. |
| `--history` | Show a summary of saved usage history. |
| `--forget-history` | Delete saved usage history after validating it. |
| `--watch <duration>` | Refresh every `1m` to `24h` and print meaningful changes. |
| `--notify` | Ring the terminal bell when a watched recommendation changes. |
| `--auth-file <path>` | Use a credential file outside `~/.codex/auth.json`. |
| `--ascii` | Use ASCII borders if box-drawing characters display poorly. |
| `--help` | Show every option. |

Credit IDs are hidden unless `--show-ids` is explicitly enabled.

## Usage history

History is off by default. `--record` stores only timestamps, usage percentages, and reset times in `~/.codex/codexresets-history.json`. It does not store tokens, account details, credit IDs, raw API responses, or recommendations.

Once at least two useful snapshots exist, normal reports automatically use them to improve the forecast.

```bash
codexresets --record
codexresets --history
codexresets --forget-history
```

## Privacy and limitations

- Your Codex credential file is read locally. Access tokens are sent only to the relevant OpenAI ChatGPT services.
- Tokens and raw authentication responses are never printed.
- If a session refresh is required, `auth.json` may be updated and secured with file mode `0600`.
- Forecasts are estimates. Usage patterns and undocumented service responses can change.
- Keep `--show-ids` off when sharing screenshots or logs.
- Never share `~/.codex/auth.json` or an unreviewed API response.

See [SECURITY.md](SECURITY.md) for security details and private vulnerability reporting.

## Troubleshooting

**Credentials not found:** Run `codex login` and confirm Codex uses file-based credential storage. If the file is elsewhere, use `--auth-file <path>`.

**Session refresh failed:** Run `codex login` again, then retry.

**Borders or colors look wrong:** Run `codexresets --ascii --color never`.

**Service format changed:** The endpoints are undocumented. Open an issue with sanitized output only—never attach credentials or a raw account response.

## Development

```bash
npm test
npm run check
npm run security:secrets
shellcheck install.sh codexresets.sh
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
