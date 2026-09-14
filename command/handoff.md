---
description: Guide workstation handoff and inspect existing Claude transfers
---

# Workstation handoff

The Alis handoff coordinator currently transfers **native Claude Code sessions only**.
This plugin does not register a native session-transfer adapter for OpenCode. Never pass
this agent's session/thread/conversation id as a Claude session id, copy private agent
state into `.claude`, call hidden `_hook`/`_agent` endpoints, or terminate this agent.

When asked to resume this OpenCode conversation on a workstation, explain that automatic
transfer is not supported by this integration. Offer a continuation summary for a new
OpenCode session on the workstation: task, repository and branch, uncommitted work,
constraints, completed external actions that must not be repeated, and next action.
A summary alone does not transfer files or start work remotely; never report otherwise.
Do not switch agents or start a Claude transfer without the user's request.

For an existing Claude handoff, check `alis workstation handoff --help` first. If the
command is absent, report that the handoff CLI release must be installed. Then use:

- `alis workstation handoff targets --json` to list enrolled SSH destinations.
- `alis workstation handoff status <handoff-id> --json` for an exact known handoff id.
- `alis workstation handoff cancel <handoff-id> --json` only when cancellation is requested.

If the user wants to move a Claude conversation, direct them to run
`/alis-build:handoff` **inside that source Claude session** with the handoff-enabled
Alis Claude plugin. It obtains the correct native session id and ends its turn so the
coordinator can reach a safe stop. Do not choose the most recent transcript or guess an id.
With several eligible destinations, ask which one; with none, report that enrollment
is needed. Keep each CLI invocation standalone and preserve its entire JSON response.

The laptop must remain awake and connected until status reports `safe_to_close: true`.
A queued transfer, unreachable destination, or summary is not an acknowledgement.
The destination may require native workspace trust or permission; do not bypass it.
Unknown remote status is not permission to restart locally. Cancellation stops remote
continuation and releases the local claim only after acknowledgement.

Claude handoff v1 requires macOS/Linux, Python 3.9+, matching supported native Claude
versions, the handoff-enabled Claude plugin on both machines, an enrolled SSH alias,
and Claude authentication on the workstation. It preserves original local work and
carries paired Alis build/Define repos, local commits and non-ignored uncommitted files.
Submodules, live processes, ignored dependencies/secrets and reverse transfer are unsupported.
