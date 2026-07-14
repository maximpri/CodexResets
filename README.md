# Codex Reset Credits

A small, privacy-conscious Codex usage planner for the terminal. It shows the current weekly limit and natural reset, estimates usage pace and depletion, recommends when a saved full reset will recover the most capacity, and sorts saved resets by expiry.

```text
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ CODEX  /  RESET CREDITS                                                                      │
│ 3 available credits                                             checked 2026-07-13 23:25 UTC │
│ UTC                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ WEEKLY USAGE                                                                                 │
│ 20% used  ·  80% left                                                    resets in 6d 0h 34m │
│     Mon 2026-07-20 00:00:00 UTC                                                              │
│ Pace  20.32 points/day day/night weighted                                  MEDIUM confidence │
│ Estimated empty                                                                 in 3d 22h 7m │
│     Fri 2026-07-17 21:32:57 UTC                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ SMART RESET PLAN                                                                  NEAR LIMIT │
│ Current pace reaches the near-limit target before the natural weekly reset.                  │
│     Recommended time                                                           in 3d 17h 23m │
│     Fri 2026-07-17 16:49:25 UTC                                                              │
│     Estimated reset value  95 points                                                         │
│     Next saved full reset                                               expires in 3d 21h 1m │
│     Fri 2026-07-17 20:26:53 UTC                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 01  Full reset                                                                         LATER │
│     Fri 2026-07-17 20:26:53 UTC                                                 in 3d 21h 1m │
│     UTC 2026-07-17 20:26                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 02  Full reset                                                                         LATER │
│     Sun 2026-07-26 19:58:13 UTC                                               in 12d 20h 32m │
│     UTC 2026-07-26 19:58                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 03  Full reset                                                                         LATER │
│     Fri 2026-07-31 15:09:24 UTC                                               in 17d 15h 43m │
│     UTC 2026-07-31 15:09                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ NOW ≤1h  SOON ≤6h  TODAY ≤24h  LATER >24h                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Requirements

- Node.js 18 or newer
- A current Codex CLI sign-in using ChatGPT
- File-based Codex credentials at `~/.codex/auth.json`, or another file supplied with `--auth-file`

This utility cannot read credentials stored only in an operating-system keyring.

## Run it

From a checkout:

```bash
cd codex-reset-credits
./check-reset-credits.sh
```

Or install the command from a local checkout:

```bash
npm install --global .
codex-reset-credits
```

The system time zone is detected automatically. Override it with any valid IANA name:

```bash
codex-reset-credits --timezone Europe/London
codex-reset-credits --timezone UTC --format json
codex-reset-credits --help
```

Credit identifiers are hidden by default. Use `--show-ids` only when you genuinely need them. For issue reports and screenshots, keep the default.

## Command reference

| Option | Purpose |
| --- | --- |
| `--timezone <name>` | Display dates in an IANA time zone such as `UTC` or `Europe/London`. |
| `--auth-file <path>` | Read Codex credentials from a non-default file. |
| `--format <table\|json>` | Select the human-readable report or normalized JSON. |
| `--color <auto\|always\|never>` | Control ANSI color output. `NO_COLOR` is also supported. |
| `--width <68-120>` | Set the table width; automatic output is capped at 96 columns. |
| `--show-ids` | Include full IDs in JSON and shortened ID suffixes in the table. |
| `--ascii` | Replace Unicode box-drawing characters with ASCII borders. |
| `--input <path\|->` | Render a saved response from a file or standard input without authentication or network access. |
| `--now <timestamp>` | Use a fixed ISO timestamp for reproducible output and tests. |
| `--help` | Show built-in usage help. |
| `--version` | Print the installed version. |

The command exits with status `0` after a successful report and a nonzero status for invalid arguments, unreadable input, authentication failures, service failures, or an unrecognized response shape. Error output is written to standard error and excludes raw response bodies.

## Render saved data safely

`--input` bypasses authentication and network access. This is useful for development, snapshot generation, and sanitized bug reports:

```bash
codex-reset-credits \
  --input test/fixtures/credits.json \
  --now 2026-07-13T23:25:36Z \
  --timezone UTC \
  --color never
```

Do not attach an unreviewed API response to a public issue. Remove identifiers and any account-specific data first.

## Privacy and security

- The tool reads the Codex credential file locally and sends its access token only to OpenAI's ChatGPT usage and reset-credit services.
- It never prints access tokens, refresh tokens, raw authentication responses, or raw API error bodies.
- It tries the existing access token first. Only after an HTTP 401 does it refresh the session and atomically update the same credential file, preserving its permissions.
- Account IDs, email, plan metadata, and spend-control details returned with usage are discarded; only the weekly rate-limit window is normalized.
- JSON output omits credit IDs unless `--show-ids` is explicitly set.
- The repository contains synthetic fixtures only. No credential files, API responses, account IDs, usernames, home-directory paths, or real credit IDs should be committed.

Treat `~/.codex/auth.json` like a password. Never copy it into this repository, a bug report, terminal transcript, or chat.

## Accuracy

The weekly percentage and reset timestamp come directly from the account usage response. The forecast is deliberately labeled as an estimate:

- The command finds the primary or secondary window closest to seven days.
- Average pace is calibrated from usage in the elapsed part of the weekly window. The elapsed time is weighted by local hour: `08:00–22:00` uses a `1.25×` daytime weight and overnight uses `0.65×`. These weights average to one across a normal 24-hour day.
- Projections apply that same profile in the selected display time zone, so usage accumulates faster during the day and more slowly overnight. This is a planning assumption, not detected personal history; no usage history is stored.
- `LOW`, `MEDIUM`, and `HIGH` describe how much of the current window has elapsed, not a statistical guarantee.
- The preferred full-reset target is 95% usage, leaving a small buffer for forecast error while recovering nearly all weekly capacity.
- The estimated reset value is the projected percentage points recovered by resetting usage to zero at the recommended time.
- If the earliest saved full reset expires before the 95% target and before the natural weekly reset, the recommendation moves to 15 minutes before expiry so its projected value is not lost. A reset with zero projected recovery value is skipped. If the natural weekly reset comes first, the saved reset is kept for the next window.

The recommendation is planning guidance, not a guarantee. A workload change can move the depletion time substantially, so rerun the command before consuming a reset.

Saved-credit urgency is based only on time remaining:

| Label | Time until expiry |
| --- | ---: |
| `NOW` | 1 hour or less, including expired credits |
| `SOON` | 6 hours or less |
| `TODAY` | 24 hours or less |
| `LATER` | More than 24 hours |

The report does not turn credit expiry into a percentage bar. The only displayed percentage is the server-provided weekly usage value (plus clearly labeled projections derived from it). It also omits the credits API's `total_earned_count`, because that field can be absent or conflict with the available-credit list and its public semantics are not documented.

## Project status and compatibility

This is an independent community project, not an official OpenAI product. It uses undocumented ChatGPT web endpoints that may change or disappear without notice. The supported Codex interface for viewing usage and using a reset credit is the `/usage` command inside the Codex TUI.

The tool is read-only with respect to credits: it lists them but never consumes one. A token refresh can update the local Codex credential file as described above.

## Troubleshooting

### Credentials were not found

Run `codex login`, confirm Codex is using file-based credential storage, and retry. If the file lives somewhere else, pass `--auth-file` or set `CODEX_AUTH_FILE`.

### The session could not be refreshed

Run `codex login` again. The command deliberately avoids printing the authentication response because it may contain sensitive details.

### The service format may have changed

The endpoints are undocumented, so their responses can change. Reproduce the problem with a fully sanitized input file before opening an issue; never attach the original credential file or an unreviewed service response.

### Borders or colors do not render correctly

Try `--ascii --color never`. For redirected output, color is disabled automatically unless `--color always` is supplied.

## Development

```bash
npm test
npm run check
shellcheck check-reset-credits.sh
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull-request guidance and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
