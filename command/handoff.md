---
description: Continue this OpenCode session in herdr on an Alis workstation
---
Use the exact current OpenCode session ID and run `alis workstation handoff
--agent opencode --session <id> --to <enrolled-alias> --json` as one standalone
command. Use `alis workstation handoff targets --json` only if the target is not
already known; choose the only eligible target or ask when several qualify.
Do not generate a recap: the native conversation resumes with “Continue where
you left off.” Preserve exact active Alis operation IDs and unknown external
results in this conversation, and stop only local watchers when recoverable.
End the turn after the coordinator returns so it can reach its safe boundary.
The independent progress window reports when `safe_to_close` is true. Keep the
laptop open until then. Use `alis workstation handoff open <id>` to open herdr,
with space `alis.os`, tab `cli.v1`, and an isolated pane and paired worktrees.
Never copy the OpenCode database, kill the source, or launch a duplicate yourself.
Unknown background work blocks handoff. Cancel through the coordinator before
resuming locally; an unreachable workstation is not cancellation acknowledgement.
