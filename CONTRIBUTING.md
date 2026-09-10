# Contributing

Thanks for helping improve CodexResets.

## Before opening a pull request

1. Keep the project dependency-free unless a dependency provides a clear security or maintenance benefit.
2. Never commit credentials, raw API responses, account identifiers, usernames, absolute home-directory paths, or real credit IDs.
3. Add or update tests for behavior changes.
4. Run `npm test`, `npm run check`, `npm run security:secrets`, and `shellcheck install.sh codexresets.sh check-reset-credits.sh`.
5. Use the synthetic fixture and a fixed `--now` value for screenshots or output examples.
6. For terminal changes, check the 40-column brief view and full layouts at 68, 80, and 96 columns, with color disabled and ASCII enabled. Keep primary stats and next actions visually distinct from secondary details.
7. For response normalization changes, test the adapter through the report renderer and JSON output. Include ISO, Unix-second, and Unix-millisecond expiries, unknown dates, and expired entries.

History fixtures must follow the strict schema documented in the README and use synthetic timestamps and percentages only. Never copy a live history file into the repository.

If forecast semantics change, update the methodology documentation and JSON tests together; increment `methodology_version` when downstream interpretation changes. The secret scanner checks tracked and nonignored untracked files plus every Git revision available in the local clone, but not ignored files. CI uses a full clone for complete reachable-history coverage.

Default live reads and approved redemption share the local Codex app-server transport. The explicit `--auth-file` path retains direct ChatGPT usage, credits, and optional subscription endpoints, which are undocumented; subscription timing on that path may also come from signed Codex authentication claims. App-server remains experimental. Treat observed response fields as untrusted input, preserve graceful fallbacks, and avoid claims about fields whose semantics are not publicly documented.

## Pull requests

Explain the user-facing change, its privacy implications, and how it was verified. Keep unrelated changes out of the same pull request.

By contributing, you agree that your contribution is licensed under the MIT License.
