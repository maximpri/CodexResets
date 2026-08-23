---
name: check-codex-resets
description: Check live Codex plan usage, exact five-hour or weekly limit reset times, and banked reset expiry dates with the bundled CodexResets CLI. Use when the user asks when Codex usage resets, how much weekly capacity remains, whether usage will last until reset, what banked resets exist, why a date differs from Codex Analytics, or to monitor usage and—with fresh explicit permission—consume a due banked reset.
---

# Check Codex Resets

Use the bundled CLI to read the authenticated Codex account. Keep reports observational unless a reset is due and the user explicitly approves the irreversible action at the live confirmation prompt.

## Check usage

Run from this skill directory so the launcher path resolves reliably:

```bash
./scripts/codexresets.sh --format json
```

Pass `--timezone <IANA name>` when the user specifies a timezone. Otherwise, allow the script to use the system timezone. JSON, redirected I/O, offline input, fixed-time reports, and `--no-redeem-prompt` cannot consume a reset.

For a weekly reset question, read only `weekly_usage` and lead with:

- `weekly_usage.resets_at`, converted to the requested or reported `time_zone`
- `weekly_usage.resets_in`
- `weekly_usage.remaining_percent`

If `weekly_usage` is `null`, say that the live response does not contain a weekly window. Do not substitute any credit-expiry date.

Keep these concepts separate:

- `weekly_usage.resets_at`: the plan's weekly usage-window reset
- `five_hour_usage.resets_at`: the rolling five-hour usage-window reset
- `next_saved_full_reset.expires_at`: when a banked reset coupon expires
- purchased or auto-reload credits: a separate balance not fetched by this plugin

When comparing with Codex Analytics, compare its **Weekly usage limit / Resets** date only to `weekly_usage.resets_at`. Explain that 12:15 AM and 00:15 are the same local time.

## Ask before using a due reset

Use this workflow whenever the user asks to monitor, use, or automatically handle a banked reset:

1. Start the checker in a persistent interactive PTY. Use `./scripts/codexresets.sh --color never` for a one-time due check. When the user asks to wait or monitor until it is time, use `./scripts/codexresets.sh --watch 15m --record --color never` and leave the session running. Do not use JSON output.
2. Let the CLI evaluate whether `USE NOW`, `USE NEAR LIMIT`, or `USE BEFORE EXPIRY` is due.
3. If no confirmation prompt appears, report the recommendation and stop. Never consume early.
4. When the CLI prints `Type "yes" to consume one banked reset now:`, leave the PTY waiting. Tell the user the projected reset value and that consumption is permanent, then ask whether to proceed.
5. Do not write `yes` to the PTY until the user gives fresh, explicit approval after seeing that prompt. A standing instruction such as "use it when due" is not approval for this step.
6. If the user approves, write `yes\n` to the same PTY session. If the user declines, write `no\n` or terminate the waiting process.
7. Read the refreshed report emitted after success and tell the user which usage windows changed.

Never call `account/rateLimitResetCredit/consume` directly from the agent. The bundled CLI owns exact-`yes` confirmation, UUID idempotency, outcome handling, and the post-redemption refresh. If the PTY session is lost, rerun the table command and ask again when the prompt reappears.

## Handle failures

If credentials are unavailable, tell the user to run `codex login`. If the local Codex app-server cannot start, confirm `codex --version` works and that the CLI is signed into the same ChatGPT account. If usage data is missing, state that directly instead of estimating from history or banked credits.

Do not use `--show-ids` unless the user explicitly requests diagnostic identifiers.

## Bundled launcher

`./scripts/codexresets.sh` invokes the standalone CodexResets CLI installed by the quick installer. It accepts the CLI options, including `--format json`, `--timezone`, `--record`, `--history`, `--watch`, and `--no-redeem-prompt`.
