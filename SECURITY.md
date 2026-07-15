# Security policy

## Security properties

- Authentication requests are sent only to fixed HTTPS OpenAI and ChatGPT endpoints, with redirects rejected.
- Access and refresh tokens are used in memory and are never included in normal table output, JSON output, or sanitized service errors.
- Usage responses are normalized to the five-hour and weekly rate-limit fields. Account metadata and raw response bodies are not rendered.
- Credit identifiers are hidden by default. Full JSON IDs and shortened terminal IDs require the explicit `--show-ids` option.
- Refreshed credentials are written to a uniquely named temporary file in the credential file's directory and atomically renamed after a concurrent-update check.
- Repository fixtures and authentication tests use visibly synthetic identifiers and token values.

These controls reduce accidental disclosure but do not make saved credentials safe to share.

## Operator responsibilities

- Keep the credential file and its parent directory private. The refresh flow preserves the credential file's existing mode, including an unsafe mode; use `chmod 600 ~/.codex/auth.json` or the equivalent for a custom `--auth-file`.
- Leave `--show-ids` disabled for shared output and when rendering an untrusted `--input` file.
- Do not share output produced with `DEBUG=1`; diagnostic stacks can contain local filesystem paths.
- Review saved API responses before using them as fixtures. Remove tokens, account data, emails, usernames, local paths, and real credit IDs.

## Repository hygiene

The `.gitignore` excludes common credential, environment, log, private-data, and saved-response filenames. Ignore rules are only a safety net: inspect staged changes and scan Git history before publishing. Pull requests must use synthetic fixtures and pass the privacy checklist in the pull-request template.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for suspected token exposure, credential-file handling flaws, or responses containing account data.

Include only the minimum reproduction needed. Replace all tokens, IDs, usernames, hostnames, and local paths with synthetic values. Never attach `auth.json` or an unredacted API response.

## Supported versions

Security fixes are applied to the latest release on the default branch.
