# Alis Build — DBD refresher

Define, Build, Deploy. Protobuf contracts live in the org's define repo
(`~/alis.build/<org>/define`); Define pins the contract to a pushed commit and generates
language packages plus platform artifacts (Spanner protobundles, Pub/Sub topics). Go
services (neurons) live in product build repos (`~/alis.build/<org>/build/<product>`);
Build runs from the latest *pushed* commit — commit and push before building. Deploy
provisions the runtime (Cloud Run plus supporting resources) from the neuron's Terraform
under `infra/`; validate via the generated playground.

## Execute through the `alis` CLI

`alis define <pkg> --json --install` · `alis build <pkg> --json --deploy -e <env>` ·
`alis deploy <pkg> --json` · `alis packages install|upgrade|add <pkg> --json`. The CLI is
self-documenting: `alis docs` and `alis <cmd> --help` are the source of truth. Under
`--json`, stdout is ONE final JSON object; progress is NDJSON on stderr — never merge
`2>&1` into a JSON parser. Never poll with `sleep` loops: block with
`alis operations wait <op> --json`. Never hand-edit dependency pins (`sed` on go.mod) or
hand-roll package-manager environments — `alis packages` handles the private registries
and credentials for you. The working directory is the context — after `alis service new`,
cd into the `buildFolder` its result reports before continuing. When a conversation
references an Ideate project (`ideas/<id>`), run `alis ideate context <id>` first.

## Skills are native

The `/discover` command and the ambient per-prompt suggestions route platform-shaped work
to registry skills — quietly and local-first: probe `alis skills suggest "<outcome>" --json`;
load only on a distinctive match (`distinctive` ≥ 3); no match means no skill and no
narration. An `<alis-skill-hint>` block on a message is that routing surface — follow it.
Generic coding (Makefiles, ordinary bugs, tests, git) needs no discovery even inside a
workspace. A loaded skill owns execution. After solving something new by hand, the user
can say "capture this as a skill" and the `/capture` command saves it for their team.

Production changes need explicit confirmation: a production deploy exits with code 3 until
re-run with `--confirm-production`, and that flag requires the user's explicit approval —
never add it yourself.
