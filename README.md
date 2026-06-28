# Alis Build opencode Plugin

**Connect [opencode](https://opencode.ai) to Alis Build.**

Use this plugin to let opencode inspect Alis Build landing zones, products, neurons,
builds, deploys, and related workspace context — the opencode counterpart of the
[Alis Build Claude Code plugin](https://github.com/alis-build/claude-plugin).

## What You Get

- A preconfigured opencode MCP server for `https://mcp.alis.build`
- OAuth sign-in through Alis Build identity (handled by opencode)
- Alis Build tools available inside opencode after sign-in
- A standing Define → Build → Deploy primer loaded into every session via opencode
  `instructions`, so the agent knows the workflow, how to route requests, and to run
  the `alis` CLI — no trigger word required
- `/build-it` and `/fix-it` workflow commands
- The `alis` CLI auto-approved via opencode `permission.bash`, so command-line calls
  run without a permission prompt each time

## How this maps from the Claude Code plugin

opencode and Claude Code expose the same capabilities through different mechanisms.
Most of the Claude plugin is **config** in opencode; only the session-id injection
needs plugin code.

| Claude Code plugin | opencode equivalent | Lives in |
| --- | --- | --- |
| `.mcp.json` (HTTP MCP + OAuth) | `mcp.api` (`type: "remote"`) | `opencode.json` |
| `commands/*.md` | `command/*.md` or `command` config key | this repo / config |
| `context/dbd-primer.md` via `SessionStart` hook | `instructions` array | `opencode.json` |
| `allow-alis-cli.sh` (`PreToolUse` Bash hook) | `permission.bash` patterns | `opencode.json` |
| `inject-skill-session-id.sh` (`PreToolUse` hook) | `tool.execute.before` plugin hook | `src/index.ts` |
| `.claude-plugin/marketplace.json` | npm package + config snippet | `package.json` |

> opencode has **no `config` hook**, so a plugin cannot register MCP servers,
> instructions, or commands programmatically. That is why those are config, and why
> install is a config snippet plus an npm package rather than a single command.

## Before You Start

You need:

- opencode installed
- An Alis Build account with access to the landing zones and products you want to use
- Network access to `https://mcp.alis.build` and the Alis Build identity provider

## Install

### 1. Add the config

Merge the contents of [`opencode.example.json`](./opencode.example.json) into your
opencode config — `~/.config/opencode/opencode.json` for a global install, or
`.opencode/opencode.json` (or `opencode.json` at the repo root) for a project install.

It wires up four things: the `@alis-build/opencode-plugin` npm plugin, the `api` MCP
server, the `/build-it` + `/fix-it` commands, and the `alis` CLI permission allow.
opencode installs the npm plugin automatically with Bun on next start.

### 2. Install the primer file

The DBD primer loads via the `instructions` array, which references a file path.
Copy the bundled primer to the path used in the config:

```sh
mkdir -p ~/.config/opencode/alis-build
curl -fsSL https://raw.githubusercontent.com/alis-build/opencode-plugin/main/instructions/dbd-primer.md \
  -o ~/.config/opencode/alis-build/dbd-primer.md
```

(Or clone this repo and point the `instructions` path at `instructions/dbd-primer.md`.)

### 3. (Optional) Install the commands as files

The `command` block in the config defines `/build-it` and `/fix-it` inline, so this
step is optional. If you prefer file-based commands, copy `command/build-it.md` and
`command/fix-it.md` into `~/.config/opencode/command/` (global) or `.opencode/command/`
(project) and drop the `command` block from your config.

### 4. Start opencode

```sh
opencode
```

## Sign In

opencode handles the MCP OAuth flow. On first use of an Alis tool it will prompt you to
authenticate, or you can trigger it explicitly:

```sh
opencode mcp auth api
```

## Use It

After sign-in, ask opencode to use Alis Build:

```text
build it
```

```text
fix it
```

```text
Use Alis Build to list the landing zones I can access.
```

```text
Show recent builds for product os in landing zone alis.
```

The `/build-it` and `/fix-it` commands run the same skill-discovery router.

### `alis` CLI auto-approval

The `permission.bash` block approves `alis ...` invocations so the CLI runs without a
prompt. opencode's bash permission matching is glob-based and **less strict than the
Claude plugin's shell hook**, which explicitly rejected chained/redirected commands
(`alis define && rm -rf`). If you want that stricter guarantee, tighten the pattern to
specific subcommands (e.g. `"alis define *": "allow"`, `"alis build *": "allow"`) and
leave everything else at the default `ask`.

## Verify before relying on this

opencode's plugin hook surface is newer and less documented than Claude Code's. Two
things should be confirmed against your installed opencode / `@opencode-ai/plugin`
version before treating this as production-ready:

1. **Session-id injection** (`src/index.ts`) — the exact hook field names (`input.tool`,
   `output.args`, and where the session id is exposed) need verifying. The handler fails
   safe: if it can't find the session id it leaves the call untouched, and the skill
   falls back to its own in-markdown discovery.
2. **Command directory name** — opencode versions have used both `command/` and
   `commands/`. The inline `command` config block avoids this ambiguity; prefer it if the
   file-based commands don't register.

## Repository layout

```
opencode-plugin/
├── README.md
├── LICENSE
├── package.json            # @alis-build/opencode-plugin (npm)
├── tsconfig.json
├── opencode.example.json   # config snippet to merge into opencode.json
├── src/
│   └── index.ts            # plugin: session-id injection hook
├── instructions/
│   └── dbd-primer.md       # always-loaded DBD primer
└── command/
    ├── build-it.md
    └── fix-it.md
```

## License

MIT © Alis Build
