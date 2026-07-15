# Contributing

Thanks for helping improve CodexResets.

## Before opening a pull request

1. Keep the project dependency-free unless a dependency provides a clear security or maintenance benefit.
2. Never commit credentials, raw API responses, account identifiers, usernames, absolute home-directory paths, or real credit IDs.
3. Add or update tests for behavior changes.
4. Run `npm test`, `npm run check`, `npm run security:secrets`, and `shellcheck install.sh codexresets.sh check-reset-credits.sh`.
5. Use the synthetic fixture and a fixed `--now` value for screenshots or output examples.

History fixtures must follow the strict schema documented in the README and use synthetic timestamps and percentages only. Never copy a live history file into the repository.

If forecast semantics change, update the methodology documentation and JSON tests together; increment `methodology_version` when downstream interpretation changes. The secret scanner checks tracked and nonignored untracked files, but not ignored files or previous Git commits.

The usage and credits endpoints are undocumented. Treat observed response fields as untrusted input, preserve graceful fallbacks, and avoid claims about fields whose semantics are not publicly documented.

## Pull requests

Explain the user-facing change, its privacy implications, and how it was verified. Keep unrelated changes out of the same pull request.

By contributing, you agree that your contribution is licensed under the MIT License.
