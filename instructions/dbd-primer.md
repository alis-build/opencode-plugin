# Alis Build — Define, Build, Deploy (DBD)

The core workflow on the Alis Build platform is **Define, Build, Deploy (DBD)**. Most
development flows touch one or more of these steps — use this framing when helping with any
Alis Build task, and walk the user through DBD rather than handing over a disconnected checklist.

> The `alis` CLI provides the *tools*; this primer provides *how to operate*. When the CLI's
> own documentation (`alis docs`, `alis <cmd> --help`) is more precise than this primer (exact
> arguments, hard constraints), follow the CLI documentation.

## Define — lock the API / platform contract

- Edit protobuf files in the organisation's `define` repo: `~/alis.build/<organisation-id>/define`.
- Commit and push, then Define against a specific, reviewed commit — the contract pins to that
  exact commit, so it has to be deliberate.
- Define pins the definition to that commit and generates consumable language packages
  (Go, JavaScript, Python, Dart, .NET, public ECMAScript when configured) and may sync platform
  artifacts such as Spanner protobundles or Pub/Sub topics.
- This is the source-of-truth step: it makes the contract reviewable, repeatable, and consumable.

## Build — implement the service and produce a deployable artifact

- Work in the product build repo: `~/alis.build/<organisation-id>/build/<product-id>`.
- Install/update the generated packages from Define with `alis packages` (see **Executing
  DBD**), then write or edit the business logic (usually Go).
- Use the generated stubs and typed APIs from Define in downstream business logic. Do not use
  proto reflection to inspect the protobuf definitions at runtime; if generated types or
  descriptors look stale or missing, update the generated packages from the latest Define output
  instead.
- **Import the service-level generated package, never the legacy product-level one.** The
  canonical Go import for a defined package `<org>.<product>.<service>.<vN>` is
  `alis.build/<org>/<product>/<service>/<vN>` (dots as slashes, e.g. `alis.zz.test.v3` →
  `alis.build/alis/zz/test/v3`). Older services may still import
  `internal.<product>.<org>.services/protobuf/...` — the deprecated product-level package. It
  resolves without error, so the only signal is the path shape: never copy it from neighboring
  services, even when every service in the repo uses it. If the service you are editing still
  depends on it, mention that and offer the `dbd-migrate-to-neuron-protos` skill rather than
  extending the legacy usage.
- **Build runs from a pushed commit, never your working tree.** `alis build` resolves the
  latest commit on the service's remote; edits that are uncommitted — or committed but not
  pushed — are invisible to the build server, so a rebuild will reproduce the exact error you
  just fixed. Commit and push first (source, Dockerfile, go.mod alike); when a rebuild fails
  identically, compare the commit hash in the build output against your fix before
  re-diagnosing. Docker build paths are relative to the neuron folder (e.g. a top-level
  Dockerfile uses `.`, not `demo/v1`).
- This connects the locked contract to real behavior.

## Deploy — provision and update the runtime

- Review the neuron's Terraform under its `infra/` folder.
- Deploy the successful build version to a real environment (e.g. DEV). The environment comes
  from the product context, not a guess.
- Deploy makes the service reachable infrastructure (commonly Cloud Run plus supporting resources).
- Validate end-to-end via the generated playground, usually `<neuron>/.playground/main_test.go`.
  Note `.playground` is hidden AND git-ignored: `rg` and `git grep` skip it by default, so
  repo-wide sweeps (e.g. import migrations) need `rg --hidden --no-ignore` to include it.

## Skills — discovery is native and quiet

The `/discover` command (and ambient per-prompt suggestions) route platform-shaped work to
registry skills. Discovery is local-first: probe with `alis skills suggest "<intended outcome>" --json` (instant, no
network); a candidate is real only when its `distinctive` score is ≥ 3. No match means no
skill — do the work without narrating discovery, and do not re-probe on follow-ups to the
same task. `alis skills search` (registry, `--limit 3`) is only for explicit "find me a
skill" asks or a genuinely ambiguous probe; on failure, fall back to the probe and continue.
Skills load live from the registry (`alis skills load <id>`); once loaded, the skill owns
execution. `alis skills install <id>` stores a complete local copy.

Not every task in an Alis workspace is platform work: Makefiles, generic bugs, tests, git
operations, and log reading need no skill and no discovery. Direct DBD commands ("define it",
"build it", "deploy it" on an already-known target) are deterministic — run the `alis` CLI
directly (see **Executing DBD**); no skill is needed.

After solving something new by hand, the user can say "capture this as a skill" and the
`/capture` command saves it as a reusable skill for their team.

## Executing DBD — the `alis` CLI

**Execute DBD through the `alis` CLI.** The CLI is deterministic, auto-detects context, and
chains deterministic steps into one call:

- **Define** (and publish packages): `alis define <pkg> --json --install`
- **Build** (optionally deploy): `alis build <pkg> --json --deploy -e <env>` — builds the
  latest *pushed* commit; commit and push fixes first
- **Deploy**: `alis deploy <pkg> --json` (add `--version` / `-e <env>` as needed)
- **Packages** (install / upgrade / add a service's language packages):
  `alis packages install|upgrade|add <pkg> --json` (add `--language go|node|python|dart` to
  scope to one language)

`<pkg>` is the package id, e.g. `alis.os.cli.v1`; it may be omitted when you are inside the
service's directory.

- **Never hand-roll package-manager environments.** Do not run `go mod tidy`, `pnpm install`,
  `pip install`, or `dart pub get` with hand-assembled `GOPROXY` / `GONOSUMDB` / registry
  settings — resolving the private Alis registries yourself is the main reason those commands
  fail. `alis packages install` refreshes registry credentials and runs the right package
  manager(s); `alis packages upgrade` bumps the service's own Alis-defined package (`--all`
  for every package). Reserve direct package-manager commands for diagnostics after
  `alis packages` has run.

- **Pass `--json` for agent-driven calls** and let the CLI resolve context (latest pushed commit,
  Dockerfile paths, single-environment target). The full machine contract — stdout/stderr
  split, NDJSON progress, `--async` + `alis operations wait`, exit codes — is documented in
  the CLI itself: `alis docs output` and `alis docs exit-codes`. Never use shell `sleep` /
  `git ls-remote` loops to pass time.
- **Diagnose before re-running.** When a Define/Build/Deploy fails or hangs, inspect before
  retrying: `alis operations describe|wait <op>` for in-flight operations, `alis doctor --json`
  for local environment faults, `alis context view --json` for products and environments, and
  `alis ask "<question>"` for grounded answers drawn from the user's own past sessions,
  support history, and skills. When a failure is platform-side (e.g. a platform-injected
  credential error such as `invalid_grant`), it is not fixable in the repo: report it and
  offer `alis support send-message` / `send-session` instead of retrying or scraping build
  consoles.
- **Ideate context by reference.** When a conversation, support ticket or copied snippet
  references an Alis Ideate project (`ideas/<id>`), run `alis ideate context <id>` first —
  one markdown document with everything the project holds (brief, contributions,
  synthesised documents). Dig further with `alis ideate specs|spec|stream|find`
  (`alis docs ideate`).
- **Auth recovery.** If a git push/pull to an Alis remote fails with an auth error, run
  `alis authorise <org>.<product> --json` (alias: `alis a`) once and retry — it installs the
  auto-refreshing Alis git credential helper and clears stale tokens. It is a one-time repair,
  not a pre-push ritual. Exit code 4 from any command means signed out → have the user run
  `alis login`. Never edit stored credential files or git auth config by hand.
- **Production deploys are gated.** A deploy targeting a production environment exits with
  code 3 until re-run with `--confirm-production`. That flag requires the user's explicit
  approval — never add it yourself; report the target to the user and ask (`alis docs safety`).
  Check which environments are production with `alis context view --json`.
- **The CLI is self-documenting — consult it, don't memorise it.** Run `alis docs` for the
  complete agent operating manual (overview, dbd, output, exit-codes, safety, context,
  workflows), `alis -h` for the command surface, and `alis <cmd> --help` for a command's
  flags. Treat that output as the source of truth; this primer and the skills deliberately
  do not restate it.

## Google documentation — prefer the Developer Knowledge MCP

When the Google Developer Knowledge MCP tools are available in this session
(`search_documents`, `get_documents`, `answer_query`), prefer them over generic web search
for Google-technology documentation — they query Google's own documentation index and return
current, canonical pages. Alis Build services run on Google Cloud (Cloud Run, Spanner,
Pub/Sub, Terraform), so this covers most platform-infrastructure questions. If the tools are
not present, research normally.
