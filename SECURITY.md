# Security policy

## Security properties

- Authentication requests are sent only to fixed HTTPS OpenAI and ChatGPT endpoints, with redirects rejected.
- Access and refresh tokens are used in memory and are never included in normal table output, JSON output, or sanitized service errors.
- Usage responses are normalized to the five-hour and weekly rate-limit fields. Account metadata and raw response bodies are not rendered.
- Credit identifiers are hidden by default. Full JSON IDs and shortened terminal IDs require the explicit `--show-ids` option.
- Refreshed credentials are written to a uniquely named mode-`0600` temporary file in the credential file's directory and atomically renamed after a concurrent-update check. The destination is forced to mode `0600`.
- Opt-in history uses a strict schema containing only check times, usage percentages, and reset times. It never serializes authentication, account, credit, recommendation, or raw-response fields.
- History writes are atomic and mode `0600`; retention and size caps limit the file to 90 days, 2,000 snapshots, and 2 MiB. Deletion validates the history schema before unlinking.
- Legacy history is migrated to the CodexResets filename only after the same strict schema validation.
- Credential and history paths cannot be the same file.
- Terminal text, including explicitly requested ID suffixes, has control and direction-changing characters neutralized before rendering.
- CI runs a dependency-free, high-confidence secret scan over tracked and unignored files. Findings include only a filename, line number, and secret type—not the matched value.
- Repository fixtures and authentication tests use visibly synthetic identifiers and token values.

These controls reduce accidental disclosure but do not make saved credentials safe to share.

## Operator responsibilities

- Keep the credential file and its parent directory private. Use `chmod 600 ~/.codex/auth.json` or the equivalent for a custom `--auth-file`; a successful refresh also enforces this mode.
- Leave `--show-ids` disabled for shared output and when rendering an untrusted `--input` file. Table output neutralizes unsafe terminal characters, but JSON intentionally includes full raw IDs when this option is enabled.
- Treat the optional history file as private usage-pattern metadata even though it has no account identifiers. Clear it with `--forget-history` before reusing the same credential-file path for another account.
- Enable `--notify` only when an audible terminal signal revealing a recommendation change is suitable for the local environment.
- Watch mode repeatedly contacts the fixed undocumented service endpoints. Do not leave its reports visible on a shared terminal.
- Do not share output produced with `DEBUG=1`; the project and home paths are redacted, but diagnostic stacks may still reveal environment details.
- Review saved API responses before using them as fixtures. Remove tokens, account data, emails, usernames, local paths, and real credit IDs.

## Repository hygiene

The `.gitignore` excludes common credential, environment, log, private-data, history, and saved-response filenames. Ignore rules and automated scanning are safety nets, not proof that a repository is clean: the scanner does not inspect ignored files or prior Git history, so inspect staged changes and scan history before publishing. Pull requests must use synthetic fixtures, run `npm run security:secrets`, and pass the privacy checklist in the pull-request template.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for suspected token exposure, credential-file handling flaws, or responses containing account data.

Include only the minimum reproduction needed. Replace all tokens, IDs, usernames, hostnames, and local paths with synthetic values. Never attach `auth.json` or an unredacted API response.

## Supported versions

Security fixes are applied to the latest release on the default branch.
