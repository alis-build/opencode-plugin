# Alis Build opencode Plugin

**Connect [opencode](https://opencode.ai) to Alis Build.**

Use this plugin to let opencode work with Alis Build organisations, products, neurons,
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
- `/discover` and `/capture` workflow commands: `/discover` probes the local catalog
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
- Catalog metadata refreshed quietly at plugin startup with `alis skills sync --cache-only`;
  the plugin never installs or prunes native user skills
- Strict `alis` CLI auto-approval via the plugin's `permission.ask` hook: clean, single
  `alis …` commands run without a prompt; chained/redirected commands
  (`alis define && rm -rf`) and the double-key carve-outs (`--confirm-production`,
  `--approve`, `blocks|block uninstall --yes`) always stay on a human prompt. Restrict
  further with a space-separated `ALIS_ALLOWED_SUBCMDS` allowlist
- An approval bridge for the alis CLI's own gates: auto-allowed `alis` commands are
  recorded at `~/.alis/agent-approval.json` (`permission_mode: "auto-allow"`) and the
  plugin exports `ALIS_OPENCODE=1` into every shell command, so the CLI can treat a
  plugin-approved command as a standing grant for non-production approvals. Production
  deploys are unaffected — the CLI always requires `--confirm-production` from a human

## How this maps from the Claude Code plugin

opencode and Claude Code expose the same capabilities through different mechanisms.

| Claude Code plugin | opencode equivalent | Lives in |
| --- | --- | --- |
| `skills/discover` + `skills/capture` (description-triggered router skills) | `/discover` + `/capture` commands (`command/*.md` or `command` config key) | this repo / config |
| `hooks/suggest-skills.sh` (`UserPromptSubmit` hook → `alis skills suggest`) | `chat.message` plugin hook appending an `<alis-skill-hint>` block | `src/index.ts` |
| `hooks/sync-skills.sh` (`SessionStart`, catalog only) | detached plugin-startup refresh using `--cache-only` | `src/index.ts` |
| `context/dbd-primer.md` + `context/dbd-digest.md` via workspace-gated `load-primer.sh` (`SessionStart`) | gated `chat.message` plugin hook (primer and digest ship in the npm package) | `src/index.ts` |
| `allow-alis-cli.sh` (`PreToolUse` Bash hook) | `permission.ask` plugin hook (+ `"alis *": "ask"` config so it fires) | `src/index.ts` |
| `~/.alis/agent-approval.json` bridge | `tool.execute.before` (bash) + `shell.env` plugin hooks | `src/index.ts` |
| `inject-service-context.sh` (`SessionStart` hook) | `chat.message` plugin hook | `src/index.ts` |
| `.claude-plugin/marketplace.json` | npm package + config snippet | `package.json` |

> The commands ship as config plus markdown files rather than being registered by
> the plugin: opencode does have a `config` hook, but keeping the command text in
> your config (and in `command/*.md`) keeps it visible and editable, and this repo's
> contract is that the inline copies stay word-for-word identical to the files. The
> primer and the alis approval logic live entirely in the plugin — no manual file
> installs.

## Before You Start

You need:

- opencode installed
- The `alis` CLI installed, on your `PATH`, and signed in (`alis login`)
- An Alis Build account with access to the organisations and products you want to use

## Install

### 1. Add the config

Merge the contents of [`opencode.example.json`](./opencode.example.json) into your
opencode config — `~/.config/opencode/opencode.json` for a global install, or
`.opencode/opencode.json` (or `opencode.json` at the repo root) for a project install.

It wires up three things: the `@alis-build/opencode-plugin` npm plugin, the
`/discover` + `/capture` commands, and the `"alis *": "ask"` bash permission that
routes `alis` commands through the plugin's strict approval hook. opencode installs
the npm plugin automatically with Bun on next start.

The primer ships inside the npm package and is injected by the plugin — there is no
separate primer install step, and primer updates arrive with plugin upgrades.

### 2. (Optional) Install the commands as files

The `command` block in the config defines `/discover` and `/capture` inline, so this
step is optional. If you prefer file-based commands, copy `command/discover.md` and
`command/capture.md` into `~/.config/opencode/command/` (global) or `.opencode/command/`
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
Use Alis Build to list the organisations I can access.
```

```text
Show recent builds for product os in organisation alis.
```

`/discover` runs the skill-discovery router explicitly; the per-prompt suggestions route
wake phrases like "alis, …" and "capture this as a skill" (the `/capture` flow)
automatically, from any directory.

### `alis` CLI auto-approval

The `"alis *": "ask"` permission pattern routes every `alis` command to the plugin's
`permission.ask` hook, which auto-allows only a clean, single `alis <subcommand> …`
invocation — the same conservative parser as the Claude plugin's shell hook. Anything
chained or redirected, and the explicit-approval carve-outs (`--confirm-production`,
`--approve`, `blocks|block uninstall --yes`), fall through to opencode's normal prompt.
If the plugin fails to load, all `alis` commands simply prompt — safe degradation.

## Repository layout

```
opencode-plugin/
├── README.md
├── LICENSE
├── package.json            # @alis-build/opencode-plugin (npm)
├── tsconfig.json
├── opencode.example.json   # config snippet to merge into opencode.json
├── src/
│   └── index.ts            # plugin: primer + service context, per-prompt skill
│                           #   suggestions, alis approval hook, agent-approval
│                           #   bridge, shell env
├── instructions/
│   ├── dbd-primer.md       # DBD primer (workspace-gated injection; synced from claude-plugin)
│   └── dbd-digest.md       # compressed digest for CLI-only sessions outside a workspace
└── command/
    ├── discover.md
    └── capture.md
```

## Primer sync

`instructions/dbd-primer.md` and `instructions/dbd-digest.md` are synced from the
canonical primer and digest in the Alis Build Claude Code plugin
(`claude-plugin/plugins/alis-build/context/dbd-primer.md` and `dbd-digest.md`) —
currently the v0.21.0 rewrite: a condensed Define section, the legacy-proto-import
guidance cut to a three-line pointer at the `dbd-migrate-to-neuron-protos` skill, a
shrunk Skills section (the discovery contract lives in the discovery surface itself),
and an Executing DBD section carrying the stdout/stderr `--json` contract, the
no-`sleep`-polling rule (`alis operations wait`), and the never-hand-edit-dependency-pins
rule (`alis packages install|upgrade`). The local differences are harness adaptations
only: the Skills sections name this plugin's `/discover` / `/capture` commands, the
ambient per-prompt suggestions, and the `<alis-skill-hint>` block instead of Claude's
`alis-build:*` skills. Sync both bodies on each claude-plugin primer release.

## License

MIT © Alis Build
