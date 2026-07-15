# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Documented credential-file permissions, identifier disclosure, debug-path exposure, repository hygiene, and the authentication/output security boundaries.

### Added

- Weekly usage percentage, remaining capacity, and natural reset timing.
- Five-hour usage reporting and short-window constraint analysis.
- Day/night-weighted depletion estimates with confidence labels and timezone-aware peak usage.
- Smart full-reset timing that accounts for whichever five-hour or weekly window reaches the 95% target first, plus saved-reset expiry and projected recovery value.
- Normalized five-hour usage, weekly usage, recommendation, and next-saved-reset fields in JSON output.

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
