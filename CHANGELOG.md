# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Credential refreshes now replace permissive file modes with `0600` while retaining atomic writes and concurrent-update protection.
- Added a dependency-free CI secret scan that checks tracked and unignored files plus every reachable Git revision without printing matched values.
- Expanded repository ignores for common package-manager credentials, service-account files, private keys, and key stores.
- Sanitized explicitly requested terminal ID suffixes and common local paths in debug stacks.
- Added strict history schema validation, atomic mode-`0600` writes, bounded retention, and validated deletion.

### Added

- Confirmation-gated banked-reset redemption through the documented Codex app-server operation, with exact-`yes` approval, UUID idempotency, safe non-interactive defaults, and an immediate post-redemption refresh.
- Quick installation from GitHub with Node.js version validation, optional user-local prefixes, revision pinning, disabled npm lifecycle scripts, and post-install verification.
- Weekly usage percentage, remaining capacity, and natural reset timing.
- Five-hour usage reporting and short-window constraint analysis.
- Day/night-weighted depletion estimates with confidence labels and timezone-aware peak usage.
- Smart banked-reset timing that accounts for whichever five-hour or weekly window reaches the 95% target first, plus banked-reset expiry and projected recovery value.
- Normalized five-hour usage, weekly usage, recommendation, and next-banked-reset data in JSON output.
- Opt-in sanitized usage history with 15-minute coalescing, 90-day retention, metadata-only inspection, and explicit deletion.
- Recorded-delta forecasts for both five-hour and weekly windows, with safe fallback to the day/night-weighted elapsed-window average.
- Sequential watch mode with material-change filtering, bounded retry backoff, and opt-in terminal-bell notifications.
- Forecast methodology, pace source, and history sample count in normalized JSON output.

### Changed

- Made the concise, confidence-aware summary the default table and moved the milestone timeline, forecast methodology, and full banked-reset inventory behind `--details`.
- Added a borderless layout for 40–67-column terminals, grouped help with examples, typo suggestions for long options, and a visible watch-mode status line.
- Standardized user-facing terminology on “banked reset,” removed the redundant checked-time milestone, and fixed repeated bullets on wrapped detail lines.
- Clarified that low-confidence future reset recommendations are provisional forecasts and documented the option to wait for a nearby natural weekly reset when uninterrupted capacity is unnecessary.
- Renamed the project to CodexResets, with `codexresets` as the primary package and command name. The previous command remains available as a compatibility alias.
- Renamed the default local history file to `codexresets-history.json`, with validated one-time migration from the previous filename.
- Custom credential-file paths receive separately scoped default history files.
- Offline fixture rendering ignores ambient history and remains deterministic.

## [1.0.0] - 2026-07-14

### Added

- Responsive color terminal report with local and UTC expiry times.
- Time-based urgency labels and deterministic offline rendering.
- Private-by-default table and JSON output.
- Safe session refresh with atomic credential updates and sanitized failures.
- Automated tests, CI, security policy, contribution guide, and synthetic fixtures.

### Changed

- Removed misleading cross-credit percentage bars and the ambiguous total-earned metric.
- Replaced the personal hard-coded time zone with automatic system detection.
