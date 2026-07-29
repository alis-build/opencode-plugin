# Alis Build opencode Plugin

**Connect [opencode](https://opencode.ai) to Alis Build.**

Use this plugin to let opencode work with Alis Build organisations, products, neurons,
builds, and deploys through the `alis` CLI — the opencode counterpart of the
[Alis Build Claude Code plugin](https://github.com/alis-build/claude-plugin).

## What You Get

- A standing Define → Build → Deploy primer injected by the plugin into the first
  message of every session, so the agent always knows the workflow, how to route
  requests (it wakes skill discovery when you address **alis**, CLI-first via
  `alis skills search|load`), and how to run the `alis` CLI
- Workspace service context: inside `~/alis.build/<org>/{build,define}/…` the plugin
  injects the package id and a pointer to the definitions ⇄ implementation counterpart
- `/build-it` and `/fix-it` workflow commands
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
| `commands/*.md` | `command/*.md` or `command` config key | this repo / config |
| `context/dbd-primer.md` via `SessionStart` hook | `chat.message` plugin hook (primer ships in the npm package) | `src/index.ts` |
| `allow-alis-cli.sh` (`PreToolUse` Bash hook) | `permission.ask` plugin hook (+ `"alis *": "ask"` config so it fires) | `src/index.ts` |
| `~/.alis/agent-approval.json` bridge | `tool.execute.before` (bash) + `shell.env` plugin hooks | `src/index.ts` |
| `inject-service-context.sh` (`SessionStart` hook) | `chat.message` plugin hook | `src/index.ts` |
| `.claude-plugin/marketplace.json` | npm package + config snippet | `package.json` |

> opencode has **no `config` hook**, so a plugin cannot register commands
> programmatically. That is why those are config, and why install is a config
> snippet plus an npm package rather than a single command. The primer and the alis
> approval logic, however, now live entirely in the plugin — no manual file installs.

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
`/build-it` + `/fix-it` commands, and the `"alis *": "ask"` bash permission that
routes `alis` commands through the plugin's strict approval hook. opencode installs
the npm plugin automatically with Bun on next start.

The primer ships inside the npm package and is injected by the plugin — there is no
separate primer install step, and primer updates arrive with plugin upgrades.

### 2. (Optional) Install the commands as files

The `command` block in the config defines `/build-it` and `/fix-it` inline, so this
step is optional. If you prefer file-based commands, copy `command/build-it.md` and
`command/fix-it.md` into `~/.config/opencode/command/` (global) or `.opencode/command/`
(project) and drop the `command` block from your config. The file and inline versions
must stay word-for-word identical — sync both when updating either.

### 3. Start opencode

```sh
opencode
```

## Use It

Ask opencode to use Alis Build:

```text
alis, build it
```

```text
alis, fix it
```

```text
Use Alis Build to list the organisations I can access.
```

```text
Show recent builds for product os in organisation alis.
```

The `/build-it` and `/fix-it` commands run the same skill-discovery router.

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
│   └── index.ts            # plugin: primer + service context, alis approval hook,
│                           #   agent-approval bridge, shell env
├── instructions/
│   └── dbd-primer.md       # DBD primer (injected by the plugin; synced from claude-plugin)
└── command/
    ├── build-it.md
    └── fix-it.md
```

## Primer sync

`instructions/dbd-primer.md` is synced from the canonical primer in the Alis Build
Claude Code plugin (`claude-plugin/plugins/alis-build/context/dbd-primer.md`). The only
local difference is the closing sentence of the Google documentation section (opencode
has no `/connect-google` command). Sync the body on each claude-plugin primer release.

## License

MIT © Alis Build
