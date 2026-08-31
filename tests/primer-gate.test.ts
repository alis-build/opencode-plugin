import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { findAlisOnPath, inAlisWorkspace, loadPrimerForMode, resolvePrimerMode } from "../src/index.ts"

const ws = "/home/dev/alis.build/org/build/prod/svc/v1"
const wsRoot = "/home/dev/alis.build"
const other = "/home/dev/projects/site"

const cli = (present: boolean) => () => present

// A probe that must never fire — the gate is lazy when the answer does not
// depend on CLI presence.
const explodingProbe = () => {
  throw new Error("probe must not be called")
}

test("workspace detection matches the shell hook's glob (*/alis.build/* or */alis.build)", () => {
  assert.equal(inAlisWorkspace(ws), true)
  assert.equal(inAlisWorkspace(wsRoot), true)
  assert.equal(inAlisWorkspace(other), false)
  assert.equal(inAlisWorkspace("/home/dev/alis.builder/x"), false)
  assert.equal(inAlisWorkspace(""), false)
})

test("gating matrix: workspace → full, CLI-only → digest, neither → off", () => {
  assert.equal(resolvePrimerMode(ws, explodingProbe, {}), "full")
  assert.equal(resolvePrimerMode(wsRoot, explodingProbe, {}), "full")
  assert.equal(resolvePrimerMode(other, cli(true), {}), "digest")
  assert.equal(resolvePrimerMode(other, cli(false), {}), "off")
  assert.equal(resolvePrimerMode("", cli(false), {}), "off")
})

test("ALIS_PRIMER overrides the gate in every direction", () => {
  // off wins everywhere, even inside a workspace with the CLI installed.
  assert.equal(resolvePrimerMode(ws, explodingProbe, { ALIS_PRIMER: "off" }), "off")
  // full outside a workspace without the CLI.
  assert.equal(resolvePrimerMode(other, explodingProbe, { ALIS_PRIMER: "full" }), "full")
  // digest inside a workspace.
  assert.equal(resolvePrimerMode(ws, explodingProbe, { ALIS_PRIMER: "digest" }), "digest")
  // An unknown value falls through to the normal gate.
  assert.equal(resolvePrimerMode(ws, explodingProbe, { ALIS_PRIMER: "bogus" }), "full")
  assert.equal(resolvePrimerMode(other, cli(false), { ALIS_PRIMER: "bogus" }), "off")
})

test("the CLI probe is only consulted when the answer depends on it", () => {
  let calls = 0
  const counting = () => {
    calls++
    return true
  }
  resolvePrimerMode(ws, counting, {})
  resolvePrimerMode(other, counting, { ALIS_PRIMER: "off" })
  assert.equal(calls, 0)
  resolvePrimerMode(other, counting, {})
  assert.equal(calls, 1)
})

test("mode selects the shipped file; a missing digest falls back to the full primer", () => {
  const files: Record<string, string | null> = {
    "dbd-primer.md": "PRIMER",
    "dbd-digest.md": "DIGEST",
  }
  const load = (name: string) => files[name] ?? null

  assert.equal(loadPrimerForMode("full", load), "PRIMER")
  assert.equal(loadPrimerForMode("digest", load), "DIGEST")
  assert.equal(loadPrimerForMode("off", load), null)

  files["dbd-digest.md"] = null
  assert.equal(loadPrimerForMode("digest", load), "PRIMER")

  files["dbd-primer.md"] = null
  assert.equal(loadPrimerForMode("digest", load), null)
  assert.equal(loadPrimerForMode("full", load), null)
})

test("the shipped digest and primer both load and stay distinct", () => {
  const digest = loadPrimerForMode("digest")
  const full = loadPrimerForMode("full")
  assert.ok(full && full.includes("Define, Build, Deploy (DBD)"))
  assert.ok(digest && digest.includes("DBD refresher"))
  assert.ok(digest!.length < full!.length)
})

test("findAlisOnPath scans PATH entries for an alis executable", () => {
  const root = mkdtempSync(join(tmpdir(), "alis-path-"))
  try {
    const withAlis = join(root, "with")
    const withoutAlis = join(root, "without")
    mkdirSync(withAlis)
    mkdirSync(withoutAlis)
    writeFileSync(join(withAlis, "alis"), "#!/bin/sh\n", { mode: 0o755 })

    assert.equal(findAlisOnPath({ PATH: `${withoutAlis}:${withAlis}` }), true)
    assert.equal(findAlisOnPath({ PATH: withoutAlis }), false)
    assert.equal(findAlisOnPath({ PATH: `${withoutAlis}::${join(root, "missing")}` }), false)
    assert.equal(findAlisOnPath({}), false)
    assert.equal(findAlisOnPath({ PATH: "" }), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
