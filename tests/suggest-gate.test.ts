import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldRunSuggest, shownSuggestHint, suggestPermissionMode } from "../src/index.ts"

test("outside the plan agent, generic prompts are prefiltered out", () => {
  assert.equal(shouldRunSuggest("build", "update the makefile", {}), false)
  assert.equal(shouldRunSuggest(undefined, "rename this variable everywhere", {}), false)
})

test("wake-phrase-shaped prompts are forwarded under any agent", () => {
  assert.equal(shouldRunSuggest("build", "alis, find me a tracing skill", {}), true)
  assert.equal(shouldRunSuggest(undefined, "capture this as a skill", {}), true)
})

test("under the plan agent every prompt is forwarded, as a plan-mode payload", () => {
  assert.equal(shouldRunSuggest("plan", "put an AI reviewer on our pull requests", {}), true)
  assert.equal(suggestPermissionMode("plan"), "plan")
  assert.equal(suggestPermissionMode("build"), "default")
  assert.equal(suggestPermissionMode(undefined), "default")
})

test("ALIS_SUGGEST_ALWAYS=1 disables the prefilter", () => {
  assert.equal(shouldRunSuggest("build", "update the makefile", { ALIS_SUGGEST_ALWAYS: "1" }), true)
})

test("a Skill store match and a wake instruction are shown; a local guess is dropped", () => {
  const ranked = "Skill store match for this request — Alis skill: block-forgejocodereviewer — Adds an AI reviewer.\nLoad with `alis skills load <id>` if relevant; otherwise ignore this note."
  const wake = "The user addressed alis by name. Before doing anything else: …"
  assert.equal(shownSuggestHint(ranked + "\n"), ranked)
  assert.equal(shownSuggestHint(wake), wake)
  assert.equal(shownSuggestHint("Possibly relevant Alis skill: build-your-first-ios-app — Guide builders.\nLoad with …"), "")
  assert.equal(shownSuggestHint("Possibly relevant Alis skills:\n  a — A.\n  b — B."), "")
  assert.equal(shownSuggestHint(""), "")
})
