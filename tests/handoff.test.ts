import { test } from "node:test"
import assert from "node:assert/strict"
import { handoffInventory, hasHandoffClaim } from "../src/index.ts"

test("idle parent still waits for active children and exports their session IDs", async () => {
 const client = { session: {
  status: async () => ({ data: { child: { type: "busy" } } }),
  children: async ({ path }: any) => ({ data: path.id === "parent" ? [{ id: "child" }] : [] }),
 } }
 assert.deepEqual(await handoffInventory(client, "parent"), { background_tasks: ["child"], session_crons: [], related_sessions: ["child"] })
})
test("unknown child inventory cannot acknowledge an idle boundary", async () => {
 const client = { session: { status: async () => ({ data: {} }), children: async () => ({ error: "unavailable" }) } }
 await assert.rejects(handoffInventory(client, "parent"), /inventory unavailable/)
})
test("invalid session IDs cannot become filesystem claims", () => {
 assert.equal(hasHandoffClaim("../another-session"), false)
})
