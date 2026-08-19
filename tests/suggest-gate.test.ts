import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldRunSuggest } from "../src/index.ts"

const ws = "/home/dev/alis.build/org/build/prod/svc/v1"
const other = "/home/dev/projects/site"

test("inside an alis.build workspace, every prompt is forwarded", () => {
  assert.equal(shouldRunSuggest(ws, "update the makefile", {}), true)
})

test("outside a workspace, generic prompts are prefiltered out", () => {
  assert.equal(shouldRunSuggest(other, "update the makefile", {}), false)
  assert.equal(shouldRunSuggest(other, "rename this variable everywhere", {}), false)
})

test("outside a workspace, wake-phrase-shaped prompts are forwarded", () => {
  assert.equal(shouldRunSuggest(other, "alis, find me a tracing skill", {}), true)
  assert.equal(shouldRunSuggest(other, "capture this as a skill", {}), true)
})

test("ALIS_SUGGEST_ALWAYS=1 disables the prefilter", () => {
  assert.equal(shouldRunSuggest(other, "update the makefile", { ALIS_SUGGEST_ALWAYS: "1" }), true)
})
