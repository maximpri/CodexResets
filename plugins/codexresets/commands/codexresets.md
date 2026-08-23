---
description: Check Codex usage, reset windows, and due banked resets through the CodexResets plugin.
---

# CodexResets

Use the installed `$check-codex-resets` skill to handle this request. Pass through the
user's text after the command:

$ARGUMENTS

Follow the skill's instructions exactly. If no request is supplied, show the current
five-hour and weekly usage windows, their exact reset times, banked-reset status, and
the recommended next action.

Keep the natural usage-window reset separate from subscription expiry and banked-reset
expiry. Never consume a banked reset unless the skill reaches its interactive prompt
and the user explicitly approves the irreversible action by typing the full word `yes`.
