import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldRunSuggest, shownSuggestHint, suggestPermissionMode } from "../src/index.ts"

test("every prompt is forwarded, under any agent", () => {
  assert.equal(shouldRunSuggest("build", "update the makefile", {}), true)
  assert.equal(shouldRunSuggest(undefined, "rename this variable everywhere", {}), true)
  assert.equal(shouldRunSuggest("plan", "put an AI reviewer on our pull requests", {}), true)
  assert.equal(shouldRunSuggest("build", "update the makefile", { ALIS_SUGGEST_ALWAYS: "1" }), true)
})

test("ALIS_SUGGEST_ALWAYS=0 forwards only wake-phrase-shaped prompts and the plan agent's", () => {
  const off = { ALIS_SUGGEST_ALWAYS: "0" }
  assert.equal(shouldRunSuggest("build", "update the makefile", off), false)
  assert.equal(shouldRunSuggest(undefined, "rename this variable everywhere", off), false)
  assert.equal(shouldRunSuggest("build", "alis, find me a tracing skill", off), true)
  assert.equal(shouldRunSuggest(undefined, "capture this as a skill", off), true)
  assert.equal(shouldRunSuggest("plan", "put an AI reviewer on our pull requests", off), true)
})

test("the plan agent reports a plan-mode payload", () => {
  assert.equal(suggestPermissionMode("plan"), "plan")
  assert.equal(suggestPermissionMode("build"), "default")
  assert.equal(suggestPermissionMode(undefined), "default")
})

test("a Skill store match asks for the skill to be named; a wake instruction is shown as is; a local guess is dropped", () => {
  const ranked = "Skill store match for this request — Alis skill: block-forgejocodereviewer — Adds an AI reviewer.\nLoad with `alis skills load block-forgejocodereviewer --via hook_hint` if relevant; otherwise ignore this note."
  const wake = "The user addressed alis by name. Before doing anything else: …"
  assert.equal(shownSuggestHint(ranked + "\n"), ranked + "\nIf you answer without loading it, name the skill in your answer so the user knows it exists.")
  assert.equal(shownSuggestHint(wake), wake)
  assert.equal(shownSuggestHint("Possibly relevant Alis skill: build-your-first-ios-app — Guide builders.\nLoad with …"), "")
  assert.equal(shownSuggestHint("Possibly relevant Alis skills:\n  a — A.\n  b — B."), "")
  assert.equal(shownSuggestHint(""), "")
})
