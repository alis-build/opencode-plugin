# Alis Build — Define, Build, Deploy (DBD)

The core workflow on the Alis Build platform is **Define, Build, Deploy (DBD)**. Most
development flows touch one or more of these steps — use this framing when helping with any
Alis Build task, and walk the user through DBD rather than handing over a disconnected checklist.

This primer is the standing how-to guide for Alis Build work. It carries three things:

1. The **mental model** — what DBD is and where things live on disk.
2. The **routing contract** — saying "alis" wakes skill discovery; when to run a command directly.
3. The **execution contract** — how to actually run Define / Build / Deploy.

> The Alis Build MCP provides the *tools*; this primer provides *how to operate*. When a
> specific tool description is more precise than this primer (exact arguments, hard
> constraints), follow the tool description.

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
- Build a container image from a product repo commit. Docker build paths are relative to the
  neuron folder (e.g. a top-level Dockerfile uses `.`, not `demo/v1`).
- This connects the locked contract to real behavior.

## Deploy — provision and update the runtime

- Review the neuron's Terraform under its `infra/` folder.
- Deploy the successful build version to a real environment (e.g. DEV). The environment comes
  from the product context, not a guess.
- Deploy makes the service reachable infrastructure (commonly Cloud Run plus supporting resources).
- Validate end-to-end via the generated playground, usually `<neuron>/.playground/main_test.go`.

## Routing — say "alis" to wake the skill router

Skill discovery is **opt-in, gated on the wake word.** What wakes the routing flow is the
developer *speaking to alis* — not the shape of the request. Do **NOT** run `SearchSkills` on
ordinary build/fix/add-sounding prompts; firing it on every functional-looking message floods
the session. Wait to be addressed.

- **Addressed to alis → wake up and route.** When the developer speaks to alis — "alis, …",
  "hey alis", "ask alis to …", "get alis to …", or otherwise invokes alis by name — wake up
  and find a skill: work out the intended outcome (ask ONE concise question only if it is
  genuinely ambiguous), call the Alis Build MCP `SearchSkills` tool FIRST with that outcome as
  the query (fall back to `ListSkills` if it returns nothing), present the matches (id, what
  each does, when to choose it), then `LoadSkill` and follow that skill — the loaded skill owns
  execution. **Do NOT inspect, write, or edit code, run Define / Build / Deploy, or make
  commits before a skill is loaded.** If nothing fits, say so and offer `RequestSkill`. Explicitly
  running the `build it` / `fix it` command is itself a way to address alis and invoke this flow.

- **Not addressed to alis → just respond.** Handle the request directly, or ask what they
  need — do not auto-route it through `SearchSkills`. If a skill would clearly help, you may
  suggest the developer "ask alis" to wake the router, but don't force it.

- **Direct DBD commands → run the CLI, no skill needed.** "define it", "deploy it", "ship it",
  "run define/build/deploy", "define and install" on an already-known target are deterministic
  — run `alis …` (see **Executing DBD**). These are explicit instructions, not skill
  discovery; they don't need the wake word.

- **Spec it → call `SpecIt` directly.** "spec it" / "spec it up", or a request to turn the
  current session into a build specification → call the `SpecIt` tool DIRECTLY (do not route
  through `SearchSkills`). It needs no arguments (session context is resolved server-side);
  pass `build_spec` only when the user names an existing one to append to. Report the returned
  BuildSpec back to the user.

- **"build it" without "alis" does not wake discovery.** A bare "build it" on an
  already-established target means the DBD Build step → run `alis build`. To discover a build
  skill instead, the developer addresses alis ("alis, build …") or runs the `build it`
  command. When genuinely unclear, ask one concise question.

## Executing DBD — prefer the `alis` CLI

When you have a shell and the `alis` CLI is on `PATH`, **execute DBD through the CLI**, not the
MCP `RunDefine` / `RunBuild` / `RunDeploy` tools. The CLI is deterministic, auto-detects
context, and chains deterministic steps into one call:

- **Define** (and publish packages): `alis define <pkg> --json --install`
- **Build** (optionally deploy): `alis build <pkg> --json --deploy -e <env>`
- **Deploy**: `alis deploy <pkg> --json` (add `--version` / `-e <env>` as needed)
- **Packages** (install / upgrade / add a service's language packages):
  `alis packages install|upgrade|add <pkg> --json` (add `--language go|node|python|dart` to
  scope to one language)

`<pkg>` is the package id, e.g. `alis.os.cli.v1`; it may be omitted when you are inside the
service's directory.

- **Never hand-roll package-manager environments.** Do not run `go mod tidy`, `pnpm install`,
  `pip install`, or `dart pub get` directly with hand-assembled `GOPROXY` / `GONOSUMDB` /
  registry settings — resolving the private Alis registries yourself is error-prone and the
  main reason those commands fail. `alis packages install` refreshes registry credentials
  automatically and runs the right package manager(s) for you; `alis packages upgrade` bumps
  the service's own Alis-defined package (`--all` for every package). Reserve direct
  package-manager commands for diagnostics after `alis packages` has run.

- **Pass `--json` for agent-driven calls** and let the CLI resolve context (latest commit,
  Dockerfile paths, single-environment target). The full machine contract — stdout/stderr
  split, NDJSON progress, `--async` + `alis operations wait`, exit codes — is documented in
  the CLI itself: `alis docs output` and `alis docs exit-codes`. Never use shell `sleep` /
  `git ls-remote` loops to pass time.
- **Auth recovery.** If a git push/pull to an Alis remote fails with an auth error, run
  `alis authorise <org>.<product> --json` (alias: `alis a`) once and retry — it installs the
  auto-refreshing Alis git credential helper and clears stale tokens. It is a one-time repair,
  not a pre-push ritual. Exit code 4 from any command means signed out → have the user run
  `alis login`. Never edit stored credential files or git auth config by hand.
- **Production deploys are gated.** A deploy targeting a production environment exits with
  code 3 until re-run with `--confirm-production`. That flag requires the user's explicit
  approval — never add it yourself; report the target to the user and ask (`alis docs safety`).
  Check which environments are production with `alis context view --json`.
- **The CLI is self-documenting — consult it, don't memorise it.** This primer names only the
  DBD core. Run `alis docs` for the complete agent operating manual (topics: overview, dbd,
  output, exit-codes, safety, context, workflows), `alis -h` for the command surface, and
  `alis <cmd> --help` for a command's flags. Treat that output as the source of truth; this
  primer and the skills deliberately do not restate it.

**Fallback.** Use the MCP `RunDefine` / `RunBuild` / `RunDeploy` tools only when there is no
shell available (remote / headless agents). They run the same operation server-side; `RunDefine`
needs an explicit commit (never `HEAD`).
