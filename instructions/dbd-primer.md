# Alis Build — Define, Build, Deploy (DBD)

The core workflow on the Alis Build platform is **Define, Build, Deploy (DBD)**. Most
development flows touch one or more of these steps — use this framing when helping with any
Alis Build task, and walk the user through DBD rather than handing over a disconnected checklist.

> The `alis` CLI provides the *tools*; this primer provides *how to operate*. When the CLI's
> own documentation (`alis docs`, `alis <cmd> --help`) is more precise than this primer,
> follow the CLI documentation.

## Read referenced support tickets first

Before proposing changes for a referenced ticket, run
`alis specialist get tickets/ID --json`. Given only a title, run
`alis specialist tickets --state all --json`, match the title, then get the ID.
Ask which ticket if several match; if none match, ask for the ID. Specialists
may use `tickets --inbox --json` for a staff-inbox reference. `support` is an
alias for `specialist`; `list` lists people, not tickets. Read the full result
and distinguish missing access from an unavailable command. Do not infer that
ticket reading is unsupported from an empty filtered help search.

## Define — lock the API / platform contract

- Edit protobuf files in the organisation's `define` repo: `~/alis.build/<organisation-id>/define`.
- Commit and push, then Define — the contract pins to that exact pushed commit and generates
  consumable language packages, and may sync platform artifacts such as Spanner protobundles
  or Pub/Sub topics. This is the source-of-truth step.

## Build — implement the service and produce a deployable artifact

- Work in the product build repo: `~/alis.build/<organisation-id>/build/<product-id>`.
- Install/update the generated packages from Define with `alis packages` (see **Executing
  DBD**), then write or edit the business logic (usually Go). Use the generated stubs and
  typed APIs; never proto reflection — stale-looking types mean the packages need updating.
- For local builds that cannot download private Alis packages, first run
  `alis packages install <pkg> --language go --json` (select the relevant language).
  It refreshes credentials and configures the package managers. Do not reconstruct
  registry settings from Dockerfiles or shell history. Installation can tidy manifests
  and lockfiles and fetches the service's latest definition; use `--version <version>`
  when intentionally preserving a specific definition version. Inspect any remaining
  error before further recovery; never bypass a TLS failure.
- The canonical Go import for a defined package `<org>.<product>.<service>.<vN>` is
  `alis.build/<org>/<product>/<service>/<vN>` (dots as slashes). A service still importing
  `internal.<product>.<org>.services/protobuf/...` is on the deprecated product-level
  package: never copy that shape from neighboring services — mention it and offer the
  `dbd-migrate-to-neuron-protos` skill instead of extending it.
- **Build runs from a pushed commit, never your working tree.** `alis build` resolves the
  latest commit on the service's remote; edits that are uncommitted — or committed but not
  pushed — are invisible to the build server, so a rebuild will reproduce the exact error you
  just fixed. Commit and push first (source, Dockerfile, go.mod alike); when a rebuild fails
  identically, compare the commit hash in the build output against your fix before
  re-diagnosing. Docker build paths are relative to the neuron folder (a top-level
  Dockerfile uses `.`, not `demo/v1`).

## Deploy — provision and update the runtime

- Review the neuron's Terraform under its `infra/` folder; deploy the built version to a
  real environment — the environment comes from the product context, not a guess.
- Validate end-to-end via the generated playground, usually `<neuron>/.playground/main_test.go`.
  Note `.playground` is hidden AND git-ignored: `rg` and `git grep` skip it by default, so
  repo-wide sweeps need `rg --hidden --no-ignore` to include it.

## Skills — discovery is native and quiet

The `/discover` command and the ambient per-prompt suggestions own skill routing for
platform-shaped work — quiet, local-first, and their own instructions carry the contract
(an `<alis-skill-hint>` block on a message is that routing surface — follow it). Generic
coding (Makefiles, ordinary bugs, tests, git operations, log reading) needs no discovery
even inside a workspace, and direct DBD commands on a known target run the CLI directly —
no skill. After solving something new by hand, the user can say "capture this as a skill"
and the `/capture` command saves it for their team. Skills learn from feedback:
`alis skills feedback <id>` reaches the skill's owner, who runs
`alis skills improve <id> --ticket <t>` to revise it from the conversation and the shared
session (`alis docs skills`).

## Executing DBD — the `alis` CLI

**Execute DBD through the `alis` CLI.** It is deterministic, auto-detects context, and
chains steps into one call:

- **Define** (and publish packages): `alis define <pkg> --json --install --async`
- **Build** (optionally deploy): `alis build <pkg> --json --deploy -e <env> --async`
- **Deploy**: `alis deploy <pkg> --version <version> -e <env> --json --async`
- **Packages**: `alis packages install|upgrade|add <pkg> --json`

`<pkg>` is the package id, e.g. `alis.os.cli.v1`; it may be omitted inside the service's
directory.

- **One standalone command per shell-tool call.** Use `alis --cwd /absolute/path <command>`
  for another workspace; after `service new`, use its `buildFolder`. Shell directory
  changes can be reset or lost when work moves to background. Preserve the exact package,
  version and environment. Consult `alis --help` once if `--cwd` support is unknown;
  an older CLI needs updating before using this option.
- **Discover environments without values.** Use `alis environment list <org>.<product>
  --json` for IDs, names, production classification and allowed branches. Request
  `environment variables` only when the task actually needs variable values.
- **Parse stdout only under `--json`.** stdout carries exactly ONE final JSON object (or an
  error envelope — follow its `retry`/`agent` fields); progress streams as NDJSON on
  stderr. Read the whole result: no pipes, `head`, `tail`, `2>&1` or `2>/dev/null`.
  They can hide failures and replace the CLI's exit code. Full contract: `alis docs output`.
  Read help output in full too; check the relevant subcommand's `--help` before
  concluding that a capability is missing.
- **Operation JSON.** Start/wait/describe expose top-level `name`, `done`, `status`,
  `version`, `notes` and `logsUri` when available (`schemaVersion: 1`). Start also
  retains legacy `metadata`; do not use that parser for wait/describe. With older
  CLIs, a missing `done` means false. Check errors before claiming success.
- **Never poll with `sleep` loops.** Long operations print an operation name — block on it
  with `alis operations wait <op> --json` (`--async` results carry the exact command in
  `next`); `alis operations list --active --json` shows what is still running.
  Keep the Alis operation name separate from the agent’s local background-task ID. Use the
  background output handle the agent returns to inspect a wait; stopping that local task
  never cancels the server operation. Resume the same operation after an auth repair.
- **Never hand-edit dependency pins or package-manager environments.** No `sed` on
  `go.mod`/`package.json`, no hand-assembled `GOPROXY`/registry settings — that is the main
  reason `go mod tidy`/`pnpm install` fail here. `alis packages install` refreshes registry
  credentials and runs the right package managers; `alis packages upgrade` bumps
  Alis-defined dependencies (`--all` for every module, `--to <version>` to pin).
- **Diagnose before re-running.** On a failed or hanging Define/Build/Deploy, inspect
  first: `alis operations describe|wait <op>`, `alis doctor --json`,
  `alis context view --json`, or `alis ask "<question>"` for grounded answers. A
  platform-side failure (e.g. a platform-injected credential error like `invalid_grant`) is
  not fixable in the repo — report it and offer `alis support send-message`/`send-session`
  instead of retrying.
- **Logs and cancellation.** With a matching CLI/backend release, use `alis logs
  build|deploy <op> --json`, `alis logs runtime <pkg> -e <env> --json`, and
  `alis operations cancel <op> --json` (build only). Confirm `stopped: true` before
  replacement work. `BACKEND_OUTDATED` requires the matching backend update.
- **Classify failures.** Legacy private-import DNS failures need package migration;
  they do not prove an agent sandbox issue. Use `alis doctor --json` and inspect
  the actual error. If flags are unexpectedly missing, inspect `type -a alis` and
  update the intended binary. No hand edits to stored credentials or registry config.
- **Ideate context by reference.** When a conversation references an Alis Ideate project
  (`ideas/<id>`), run `alis ideate context <id>` first — one markdown document with
  everything the project holds; dig with `alis ideate specs|spec|stream|find`
  (`alis docs ideate`).
- **Auth recovery.** A git auth failure against an Alis remote: run
  `alis authorise <org>.<product> --json` once and retry — a one-time repair, not a
  pre-push ritual. Exit code 4 anywhere means signed out → the user runs `alis login`.
  Never edit stored credential files or git auth config by hand.
- **Production deploys are gated.** Prepare the exact built version or pushed commit,
  target environments and any branch override. Present the CLI's pinned retry for
  explicit user approval through the agent's native confirmation flow. After approval,
  execute it with `--confirm-production` and verify its operation (`alis docs safety`).
  Keep the approved version, targets and flags unchanged. Auto mode, `--approve` and
  broad task intent are not production consent. Respect native policy denials.
- **The CLI is self-documenting — consult it, don't memorise it.** `alis docs` is the
  complete agent operating manual and the source of truth for flags, output shapes and exit
  codes; the bullets above are the behavioural rules, not a restatement of it.
