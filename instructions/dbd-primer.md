# Alis Build — Define, Build, Deploy (DBD)

The core workflow on the Alis Build platform is **Define, Build, Deploy (DBD)**. Most
development flows touch one or more of these steps — use this framing when helping with any
Alis Build task, and walk the user through DBD rather than handing over a disconnected checklist.

This primer is the standing how-to guide for Alis Build work. It carries three things:

1. The **mental model** — what DBD is and where things live on disk.
2. The **routing contract** — when to discover a skill, when to run a command directly.
3. The **execution contract** — how to actually run Define / Build / Deploy.

> The Alis Build MCP provides the *tools*; this primer provides *how to operate*. When a
> specific tool description is more precise than this primer (exact arguments, hard
> constraints), follow the tool description.

## Define — lock the API / platform contract

- Edit protobuf files in the landing zone `define` repo: `~/alis.build/<organisation-id>/define`.
- Commit and push, then Define against a specific, reviewed commit — the contract pins to that
  exact commit, so it has to be deliberate.
- Define pins the definition to that commit and generates consumable language packages
  (Go, JavaScript, Python, Dart, .NET, public ECMAScript when configured) and may sync platform
  artifacts such as Spanner protobundles or Pub/Sub topics.
- This is the source-of-truth step: it makes the contract reviewable, repeatable, and consumable.

## Build — implement the service and produce a deployable artifact

- Work in the product build repo: `~/alis.build/<organisation-id>/build/<product-id>`.
- Install/update the generated packages from Define, then write or edit the business logic
  (usually Go).
- Build a container image from a product repo commit. Docker build paths are relative to the
  neuron folder (e.g. a top-level Dockerfile uses `.`, not `demo/v1`).
- This connects the locked contract to real behavior.

## Deploy — provision and update the runtime

- Review the neuron's Terraform under its `infra/` folder.
- Deploy the successful build version to a real environment (e.g. DEV). The environment comes
  from the product context, not a guess.
- Deploy makes the service reachable infrastructure (commonly Cloud Run plus supporting resources).
- Validate end-to-end via the generated playground, usually `<neuron>/.playground/main_test.go`.

## Routing — discover a skill vs run a command directly

Not every Alis Build request is the same kind of work. Classify first, then act.

- **Routers — discover a skill before acting.** For an ambiguous *functional* request — the
  user wants to build, fix, add, or change something and the agent needs to know *how* — treat
  it as a router, not a direct task. Triggers: "build it", "fix it", "add X", "change Y", and
  capability questions ("can you help with tracing?", "are you able to add X?").
  - Work out the intended outcome (ask ONE concise question only if it is genuinely ambiguous),
    then call the Alis Build MCP `SearchSkills` tool FIRST with that outcome as the query (fall
    back to `ListSkills` if it returns nothing).
  - Present the matching skills (id, what each does, when to choose it), ask which to use, and
    only then call `LoadSkill` and follow that skill's workflow — the loaded skill owns
    execution.
  - **Do NOT inspect, write, or edit code, run Define / Build / Deploy, or make commits before
    a skill is loaded.** If no skill fits, say so and offer `RequestSkill`.
  - For a capability question, briefly confirm it is Alis Build work, then ask the user to name
    the specific change so you can route it through `SearchSkills`. Do not dive into the
    codebase or give a generic how-to before they name the concrete change.

- **Direct DBD commands — run the CLI, no skill needed.** When the user asks to run a *DBD
  step* on an already-known target service, just run it (see **Executing DBD**). Triggers:
  "define it", "deploy it", "ship it", "run define/build/deploy", "define and install". These
  are deterministic; they do not need skill reasoning.

- **Spec it — call `SpecIt` directly.** "spec it" / "spec it up", or a request to turn the
  current session into a build specification → call the `SpecIt` tool DIRECTLY (do not route
  through `SearchSkills`). It needs no arguments (session context is resolved server-side);
  pass `build_spec` only when the user names an existing one to append to. Report the returned
  BuildSpec back to the user.

- **"alis" (vocative) / "dbd"** engage Alis Build context generally — then disambiguate with
  the cases above.

- **"build it" is overloaded.** It can mean "construct this feature" (a router) or "run the
  Build step" (the `alis build` command). If a build target/context is already established and
  the user means the DBD step, run `alis build`; if it is a functional request, route via
  `SearchSkills`; when genuinely unclear, ask one concise question.

Whenever a later request in the session would benefit from an Alis Build skill, use
`SearchSkills` to discover one before doing the work yourself.

## Executing DBD — prefer the `alis` CLI

When you have a shell and the `alis` CLI is on `PATH`, **execute DBD through the CLI**, not the
MCP `RunDefine` / `RunBuild` / `RunDeploy` tools. The CLI is deterministic, auto-detects
context, and chains deterministic steps into one call:

- **Define** (and publish packages): `alis define <pkg> --json --install`
- **Build** (optionally deploy): `alis build <pkg> --json --deploy -e <env>`
- **Deploy**: `alis deploy <pkg> --json` (add `--version` / `-e <env>` as needed)

`<pkg>` is the package id, e.g. `alis.os.cli.v1`; it may be omitted when you are inside the
service's directory.

- **Pass `--json` for agent-driven calls.** `stdout` then carries the operation as a single
  structured JSON object — parse `version`, `state` / `done`, `logs_uri`, and `error` from it
  rather than scraping prose. Progress streams on `stderr`; the human one-liner (no `--json`)
  is only for narrating to the user.
- **Let the CLI resolve context.** It auto-detects the latest commit, Dockerfile build/retag
  paths, and a single-environment target. Don't hand-orchestrate these or ask the user for a
  commit SHA the CLI will pick.
- **Long-running operations** stream to completion by default. Use `--async` to start one and
  print its name, then re-attach with `alis operations wait <name> --json`. Never use shell
  `sleep` / `git ls-remote` loops to pass time.
- **The CLI is self-documenting — consult it, don't memorise it.** This primer names only the
  DBD core. For the full command surface (e.g. `service new`, `packages`, `product`,
  `environment`, `operations`, `login`) run `alis -h`; for a command's flags run
  `alis <cmd> --help`. Treat that output as the source of truth; this primer and the skills
  deliberately do not restate it.

**Fallback.** Use the MCP `RunDefine` / `RunBuild` / `RunDeploy` tools only when there is no
shell available (remote / headless agents). They run the same operation server-side; `RunDefine`
needs an explicit commit (never `HEAD`).

## Getting deeper

For onboarding or the full step-by-step Simple API quickstart, load the `getting-started` skill
via `LoadSkill`. For an ambiguous "build it" / "fix it" request, route through skill discovery
(`SearchSkills`) before executing any DBD step.
