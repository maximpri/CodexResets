# Codex Reset Credits

A privacy-conscious terminal planner for Codex usage limits and saved full-reset credits.

> [!IMPORTANT]
> This is an independent community project, not an official OpenAI product. It uses undocumented ChatGPT web endpoints that may change without notice. The supported interface for viewing usage and consuming a reset remains the `/usage` command in the Codex TUI.

It answers three practical questions:

- How much of the five-hour and weekly limits is left?
- At the current or optionally recorded pace, which window is likely to become constrained first?
- When should the next saved full reset be used to recover the most value before it expires?

## Highlights

- Reports both five-hour and weekly usage, natural reset times, remaining capacity, and projected depletion.
- Builds a timezone-aware forecast with higher daytime usage and lower overnight usage, then improves it from sanitized local deltas when recording is enabled.
- Recommends using, saving, or skipping the next full reset based on the first constrained window, reset value, natural resets, and credit expiry.
- Can watch for material recommendation changes and ring the terminal bell without flooding the terminal with unchanged reports.
- Stores no usage history unless `--record` is requested; recorded snapshots contain only timestamps, percentages, and reset times.
- Keeps credit IDs private by default and discards unrelated account metadata from the usage response.
- Supports readable terminal output, normalized JSON, deterministic offline fixtures, narrow terminals, ASCII borders, and optional color.
- Remains read-only for reset credits: it never consumes a credit.

## Example report

```text
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ CODEX  /  RESET CREDITS                                                                      │
│ 3 available credits                                             checked 2026-07-13 23:25 UTC │
│ UTC                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 5-HOUR USAGE                                                                                 │
│ 20% used  ·  80% left                                                       resets in 3h 34m │
│     Tue 2026-07-14 03:00:00 UTC                                                              │
│ Pace  21.57 points/hour day/night weighted                                   HIGH confidence │
│ Estimated empty  after 5-hour reset                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ WEEKLY USAGE                                                                                 │
│ 20% used  ·  80% left                                                    resets in 6d 0h 34m │
│     Mon 2026-07-20 00:00:00 UTC                                                              │
│ Pace  20.32 points/day day/night weighted                                  MEDIUM confidence │
│ Estimated empty                                                                 in 3d 22h 7m │
│     Fri 2026-07-17 21:32:57 UTC                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ SMART RESET PLAN                                                                  NEAR LIMIT │
│ Weekly usage reaches the near-limit target before its natural reset.                         │
│     Recommended time                                                           in 3d 17h 23m │
│     Fri 2026-07-17 16:49:25 UTC                                                              │
│     Weekly reset value  95 points                                                            │
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

## Quick start

### Requirements

- Node.js 18 or newer
- A current Codex CLI sign-in using ChatGPT
- File-based Codex credentials at `~/.codex/auth.json`, or another file supplied with `--auth-file`

This utility cannot read credentials stored only in an operating-system keyring.

### Run from a checkout

```bash
cd codex-reset-credits
./check-reset-credits.sh
```

### Install from a local checkout

```bash
npm install --global .
codex-reset-credits
```

The system time zone is detected automatically. Override it with any valid IANA name:

```bash
codex-reset-credits --timezone Europe/London
codex-reset-credits --timezone UTC --format json
codex-reset-credits --record
codex-reset-credits --watch 15m --record --notify
codex-reset-credits --help
```

Credit identifiers are hidden by default. Use `--show-ids` only when you genuinely need them. For issue reports and screenshots, keep the default.

## How it works

1. Reads the existing file-based Codex session from `auth.json`.
2. Fetches the account's usage windows and available saved-reset credits from fixed ChatGPT HTTPS endpoints.
3. Identifies the window closest to five hours and the window closest to seven days, then keeps only the usage and reset fields needed for the report.
4. Estimates each window's pace and depletion time with a local-time profile that assumes heavier daytime use and lighter overnight use. If sanitized history exists, matching observations from the current reset window replace the elapsed-window average with a recorded delta.
5. Compares the two 95% target times, natural resets, the next credit's expiry, and the capacity that credit would recover.
6. Renders a terminal or JSON report. It never consumes a reset credit or modifies account usage. An authentication refresh may atomically update `auth.json`, and `--record` may update the separate local history file.

The smart-plan outcomes are:

| Outcome | Meaning |
| --- | --- |
| `USE NOW` | An active window is already at or above the 95% target. |
| `NEAR LIMIT` | The five-hour or weekly window is projected to reach 95% before its natural reset. |
| `BEFORE EXPIRY` | The next saved reset expires before the preferred target, so use it near expiry to retain its projected value. |
| `WAIT` | Active windows should reset naturally before reaching the target. |
| `SKIP / WAIT` | The expiring saved reset has no projected recovery value. |
| `NO CREDIT` | No usable saved full reset is available. |

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
| `--record` | Save a sanitized live snapshot and use existing snapshots for a better pace estimate. |
| `--history` | Show a metadata-only summary of local history, without authentication or network access. |
| `--forget-history` | Validate and delete the selected local history file. |
| `--history-file <path>` | Select a non-default history file. |
| `--watch <duration>` | Poll live data every `1m` to `24h` and print only material recommendation changes. |
| `--notify` | With `--watch`, ring the terminal bell when a changed report is printed. |
| `--help` | Show built-in usage help. |
| `--version` | Print the installed version. |

The command exits with status `0` after a successful report and a nonzero status for invalid arguments, unreadable input, authentication failures, service failures, or an unrecognized response shape. Error output is written to standard error and excludes raw response bodies.

## Private usage history

History is opt-in. Add `--record` to a live report whenever you want to capture a snapshot:

```bash
codex-reset-credits --record
codex-reset-credits --history
```

Once snapshots exist, ordinary live reports use matching observations automatically; `--record` is needed only to add the current observation. The default file is `~/.codex/reset-credits-history.json`, or the equivalent under `CODEX_HOME`. A custom `--auth-file` gets a separately scoped default history filename so different profiles do not silently share forecasts. `CODEX_HISTORY_FILE` and `--history-file` override that location.

The on-disk schema is deliberately narrow. Each snapshot may contain only its check time and, for each available window, the used percentage and natural reset time. It never stores tokens, session IDs, account IDs, email addresses, credit IDs, titles, raw API responses, recommendations, or local paths. Writes are atomic, newly created directories use mode `0700`, the file is forced to mode `0600`, observations within the same 15-minute bucket are coalesced, and data is limited to 90 days, 2,000 snapshots, and 2 MiB.

Use `--forget-history` to validate and delete the selected history file. The CLI also refuses to use the same path for credentials and history. If you sign in to a different account using the same credential-file path, clear that path's history first. Offline `--input` reports never read or write ambient history, which keeps fixtures deterministic.

Malformed or expanded history causes `--record`, `--history`, and `--forget-history` to fail safely. An ordinary live report warns once and falls back to the elapsed-window average rather than overwriting the file.

## Watch for recommendation changes

```bash
codex-reset-credits --watch 15m --record
codex-reset-credits --watch 5m --record --notify
```

Watch mode performs one request at a time, prints the first report immediately, and then prints only when the recommended action, constraining window, timing-urgency bucket, or next saved-reset expiry changes. After that successful baseline, temporary network, rate-limit, and server failures use bounded exponential backoff; permanent authentication and input errors stop the command. Intervals must be between one minute and 24 hours.

Watch mode currently supports live table output only. `--notify` emits a terminal bell only when standard output is an interactive terminal. It does not send desktop, email, or network notifications.

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
- It tries the existing access token first. Only after an HTTP 401 does it refresh the session and atomically update the same credential file, forcing its mode to `0600`.
- Account IDs, email, plan metadata, and spend-control details returned with usage are discarded; only the five-hour and weekly rate-limit windows are normalized.
- JSON output omits credit IDs unless `--show-ids` is explicitly set.
- Local history is disabled by default and uses a strict allowlist when enabled; malformed or expanded history is never trusted or overwritten silently.
- CI scans tracked and unignored files for high-confidence secret formats and reports only filenames, line numbers, and finding types.
- The repository contains synthetic fixtures only. No credential files, API responses, account IDs, usernames, home-directory paths, or real credit IDs should be committed.

Treat `~/.codex/auth.json` like a password. Never copy it into this repository, a bug report, terminal transcript, or chat. Confirm that it is readable only by your user—for example, `chmod 600 ~/.codex/auth.json`. A successful refresh repairs a permissive credential file to mode `0600`, but you should not rely on a future refresh to secure it.

Keep `--show-ids` disabled for screenshots, logs, and untrusted `--input` files. `DEBUG=1` sanitizes the project and home path but can still expose environment details in diagnostic stacks, so do not enable it in output you intend to share. A terminal bell can reveal locally that a recommendation changed; enable `--notify` only when that is appropriate. See [SECURITY.md](SECURITY.md) for the complete operational guidance and private reporting process.

## Accuracy

The five-hour and weekly percentages and reset timestamps come directly from the account usage response. The forecast is deliberately labeled as an estimate:

- The command identifies the primary or secondary windows by duration: the candidate closest to five hours becomes the short window, and the candidate closest to seven days becomes the weekly window.
- Without usable history, average pace is calibrated independently from usage in the elapsed part of each window. The elapsed time is weighted by local hour: `08:00–22:00` uses a `1.25×` daytime weight and overnight uses `0.65×`. These weights average to one across a normal 24-hour day.
- With at least two matching observations spanning 15 minutes in the active reset window, the forecast uses the observed percentage delta instead. A short zero-delta sample falls back to the elapsed-window average so an idle interval does not erase the projection. A recorded forecast reaches `HIGH` confidence only after at least four samples spanning one-quarter of that window.
- Five-hour pace is displayed in percentage points per hour; weekly pace is displayed in percentage points per day.
- Projections apply the same day/night profile in the selected display time zone, so usage accumulates faster during the day and more slowly overnight. Recorded history changes the baseline pace, not the time-of-day weights.
- `LOW`, `MEDIUM`, and `HIGH` describe the amount of usable elapsed-window or recorded-history evidence, not a statistical guarantee.
- JSON reports include `methodology_version: 2`, `pace_source`, and `history_sample_count` so downstream consumers can distinguish `recorded_history`, `window_average`, and `insufficient_data` forecasts.
- The preferred full-reset target is 95% usage. The recommendation uses whichever active window is projected to reach that target first before its own natural reset.
- Reset value is reported separately for the five-hour and weekly windows when each window is still active at the recommended time.
- If the earliest saved full reset expires before the next 95% target and before the weekly reset, the recommendation moves to 15 minutes before expiry so its projected value is not lost. A reset with zero projected recovery value is skipped. If the weekly reset comes first, the saved reset is kept for the next window.

The recommendation is planning guidance, not a guarantee. A workload change can move the depletion time substantially, so rerun the command before consuming a reset.

Saved-credit urgency is based only on time remaining:

| Label | Time until expiry |
| --- | ---: |
| `NOW` | 1 hour or less, including expired credits |
| `SOON` | 6 hours or less |
| `TODAY` | 24 hours or less |
| `LATER` | More than 24 hours |

The report does not turn credit expiry into a percentage bar. Displayed usage percentages come from the server-provided five-hour and weekly windows, plus clearly labeled projections derived from them. It also omits the credits API's `total_earned_count`, because that field can be absent or conflict with the available-credit list and its public semantics are not documented.

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
npm run security:secrets
shellcheck check-reset-credits.sh
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull-request guidance and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
