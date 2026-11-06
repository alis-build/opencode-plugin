# Alis Build opencode Plugin

Plugin 0.18.0 uses native Go hooks in Alis CLI 1.185.3 or newer. Upgrade the CLI
before updating the plugin, then restart OpenCode.

**Connect [opencode](https://opencode.ai) to Alis Build.**

Use this plugin to let opencode work with build environments, products, services,
builds, and deploys through the `alis` CLI — the opencode counterpart of the
[Alis Build Claude Code plugin](https://github.com/alis-build/claude-plugin).

## What You Get

- A standing Define → Build → Deploy primer injected by the plugin into the first
  message of every session, so the agent always knows the workflow, the skills
  contract (quiet, local-first discovery through `/discover` and ambient per-prompt
  suggestions; direct DBD commands run the CLI with no skill), and how to run the
  `alis` CLI. The primer is workspace-gated: sessions whose working directory sits
  inside an alis.build workspace get the full primer; outside a workspace, a machine
  with the `alis` CLI installed gets a compressed digest so wake-word skill routing
  keeps minimal context; a machine with neither gets nothing — zero tokens for
  unrelated projects. `ALIS_PRIMER=full|digest|off` overrides the gate
- Workspace service context: inside `~/alis.build/<org>/{build,define}/…` the plugin
  injects the package id and a pointer to the definitions ⇄ implementation counterpart
- `/discover` and `/capture` workflow commands: `/discover` probes the local catalogue
  first (`alis skills suggest --json`, ~40ms, no network), loads a registry skill only
  on a distinctive match, and stays silent otherwise (registry `search` is reserved for
  explicit "find me a skill" asks); `/capture` saves work just completed in the session
  as a reusable team skill
- Ambient per-prompt skill suggestions: the plugin pipes user messages to
  `alis skills suggest --hook --harness opencode` (a purely local ~40ms call) and appends
  any suggestion to the message as an `<alis-skill-hint>` block. Wake phrases ("alis, …",
  "capture this as a skill") yield deterministic routing instructions and work from any
  directory; other prompts get at most one confidence-gated one-liner (the CLI keys on
  distinctive id/name-token evidence, so generic Makefile/rename/debug prompts stay
  silent), and every failure path is silent. Inside an alis.build workspace every prompt
  reaches the CLI; elsewhere a cheap prefilter forwards only prompts that could carry a
  wake phrase (`ALIS_SUGGEST_ALWAYS=1` disables the prefilter)
- Native Go handlers for permission decisions, secret-output warnings, catalogue
  refresh, and handoff coordination. The plugin passes JSON directly to the installed
  `alis` binary; these hooks do not invoke Python, Bash, or jq
- Strict CLI permissions through the same Go policy as the other Alis plugins.
  Read-only queries and supported DBD workflows can be auto-allowed according to
  the CLI automation tier. Production, destructive actions, secret reveal, and
  explicit approval flags remain on a human prompt. Chained commands, redirects,
  expansions, and commands outside `ALIS_ALLOWED_SUBCMDS` receive no auto-allow
- Secret-looking tool input/output gets a warning containing kinds and counts only;
  the warning never repeats the values. Warnings are deduplicated by session
- Session identity via `ALIS_OPENCODE` and `ALIS_SESSION_ID`. The plugin does not
  write shared approval records or grant standing permission for CLI actions

## How this maps from the Claude Code plugin

Shared Alis workflows use agent-specific mechanisms. OpenCode retains its native
session transfer and vendor session-inventory callbacks.

| Claude Code plugin | opencode equivalent | Lives in |
| --- | --- | --- |
| `skills/discover` + `skills/capture` (description-triggered router skills) | `/discover` + `/capture` + `/handoff` commands (`command/*.md` or `command` config key) | this repo / config |
| `hooks/suggest-skills.sh` (`UserPromptSubmit` hook → `alis skills suggest`) | `chat.message` plugin hook appending an `<alis-skill-hint>` block | `src/index.ts` |
| `hooks/sync-skills.sh` (`SessionStart`, catalogue only) | native startup sync (older CLI fallback uses `--cache-only`) | `alis` Go handlers |
| `context/dbd-primer.md` + `context/dbd-digest.md` via workspace-gated `load-primer.sh` (`SessionStart`) | gated `chat.message` plugin hook (primer and digest ship in the npm package) | `src/index.ts` |
| `allow-alis-cli.sh` (`PreToolUse` Bash hook) | `permission.ask` callback → native Go permission policy | `alis` Go handlers |
| Per-call session attribution | `shell.env` exports identity; no shared approval grant | `src/index.ts` |
| `inject-service-context.sh` (`SessionStart` hook) | `chat.message` plugin hook | `src/index.ts` |
| `.claude-plugin/marketplace.json` | npm package + config snippet | `package.json` |

> The commands ship as config plus markdown files rather than being registered by
> the plugin: opencode does have a `config` hook, but keeping the command text in
> your config (and in `command/*.md`) keeps it visible and editable, and this repo's
> contract is that the inline copies stay word-for-word identical to the files. The
> primer ships with the plugin and the approval policy lives in the Go CLI — no
> manual helper installs.

## Before You Start

You need:

- opencode installed
- Alis CLI **1.185.3 or newer**, on your `PATH` (`alis upgrade`), and signed in (`alis login`)
- An Alis Build account with access to the build environments and products you want to use

## Install

An older CLI receives one upgrade notice per plugin load and normal OpenCode
permission prompts. Catalogue refresh and the existing handoff coordinator retain
compatibility; an unavailable CLI still blocks local continuation when a source
handoff claim exists.

### 1. Add the config

Merge the contents of [`opencode.example.json`](./opencode.example.json) into your
opencode config — `~/.config/opencode/opencode.json` for a global install, or
`.opencode/opencode.json` (or `opencode.json` at the repo root) for a project install.

It wires up three things: the `@alis-build/opencode-plugin` npm plugin, the
`/discover` + `/capture` + `/handoff` commands, and the `"alis *": "ask"` bash permission that
routes `alis` commands through the plugin's strict approval hook. opencode installs
the npm plugin automatically with Bun on next start.

The primer ships inside the npm package and is injected by the plugin — there is no
separate primer install step, and primer updates arrive with plugin upgrades.

### 2. (Optional) Install the commands as files

The `command` block in the config defines `/discover`, `/capture`, and `/handoff` inline, so this
step is optional. If you prefer file-based commands, copy `command/discover.md` and
`command/capture.md` and `command/handoff.md` into `~/.config/opencode/command/` (global) or `.opencode/command/`
(project) and drop the `command` block from your config. The file and inline versions
must stay word-for-word identical — sync both when updating either.

### 3. Start opencode

```sh
opencode
```

## Use It

Ask opencode to use Alis Build:

```text
/discover
```

```text
alis, add tracing to my service
```

```text
capture this as a skill
```

```text
Use Alis Build to list the build environments I can access.
```

```text
Show recent builds for product os in build environment alis.
```

`/discover` runs the skill-discovery router explicitly; the per-prompt suggestions route
wake phrases like "alis, …" and "capture this as a skill" (the `/capture` flow)
automatically, from any directory.

### `alis` CLI auto-approval

The `"alis *": "ask"` permission pattern routes CLI commands through the native
Go permission policy. OpenCode receives only an allow, ask, or deny decision;
the plugin never inserts `--approve` into a command. In the manual CLI tier,
confirm the exact action and target before rerunning with `--approve`. Production
still requires explicit approval of its pinned version, environment and branch.
If the CLI is missing or too old, normal OpenCode permissions apply.

## Repository layout

```
opencode-plugin/
├── README.md
├── LICENSE
├── package.json            # @alis-build/opencode-plugin (npm)
├── tsconfig.json
├── opencode.example.json   # config snippet to merge into opencode.json
├── src/
│   ├── index.ts            # plugin: primer + service context, per-prompt skill
│                           #   suggestions and host callbacks
│   └── native-hooks.ts     # bounded JSON transport to the Go CLI hooks
├── instructions/
│   ├── dbd-primer.md       # DBD primer (workspace-gated injection; synced from claude-plugin)
│   └── dbd-digest.md       # compressed digest for CLI-only sessions outside a workspace
└── command/
    ├── discover.md
    └── capture.md
```

## Conversation reading and package setup

Read referenced conversations before proposing changes: use
`alis specialist get tickets/ID --json`, or find the title with
`alis specialist tickets --state all --json`. Use `alis packages install`
for private package setup during Build. Read command results and help in full.

If this guidance is absent after updating, confirm the Alis plugin is enabled
and restart the agent. The CLI alone does not activate the agent plugin.
For immediate guidance, read `alis docs specialist` and
`alis packages install --help`.

## Primer sync

`instructions/dbd-primer.md` and `instructions/dbd-digest.md` are synced from the
canonical primer and digest in the Alis Build Claude Code plugin
(`claude-plugin/plugins/alis-build/context/dbd-primer.md` and `dbd-digest.md`) —
baseline v0.23.0, with conversation and package guidance from v0.25.1. The local differences are coding agent adaptations
only: the Skills sections name this plugin's `/discover` / `/capture` commands, the
ambient per-prompt suggestions, and the `<alis-skill-hint>` block instead of Claude's
`alis:*` skills. Sync both bodies on each claude-plugin primer release.

## License

MIT © Alis Build

## Workstation handoff and Claude parity

Shared CLI guidance is synced with [Claude plugin v0.23.0](https://github.com/alis-build/claude-plugin/commit/2cb12b52d2d74c642f58ccd5bee58cd12b9dacfe):
standalone commands, environment discovery without variable values, asynchronous
operations, complete JSON results, logs/cancellation and pinned production approval.
Native hook payloads and permission mechanisms remain specific to this agent.

Handoff opens the continuation in herdr, grouped by dotted dimensions: space
`alis.os`, tab `cli.v1`, with a separate pane and paired build/Define worktrees
for each session. The independent progress window must report `safe_to_close`
before the laptop closes; a terminal being open is not agent acceptance.

OpenCode exports and imports native session history through its supported CLI
into a dedicated destination database. The default prompt is “Continue where
you left off.” The source plugin fences only the selected session, retaining
other sessions hosted by the same process.

Requires the matching CLI, workstation runtime and agent integration on both
machines, enrolled SSH and independent destination authentication. Use
`alis workstation handoff status <id> --watch --json`, `open <id>`, or `cancel <id>`.
Preserve exact Alis operation IDs and continue monitoring them rather than
restarting a Define, Build or Deploy. Original local files and history remain.
