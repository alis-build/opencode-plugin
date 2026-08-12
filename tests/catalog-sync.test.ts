import assert from "node:assert/strict"
import test from "node:test"

import { CATALOG_SYNC_ARGS, startCatalogSync } from "../src/index.ts"

test("plugin startup refreshes catalog metadata only", () => {
  let command = ""
  let args: readonly string[] = []
  let options: unknown
  let errorHandlerRegistered = false
  let unrefCalled = false

  startCatalogSync(((gotCommand: string, gotArgs: readonly string[], gotOptions: unknown) => {
    command = gotCommand
    args = gotArgs
    options = gotOptions
    return {
      on(event: "error") {
        errorHandlerRegistered = event === "error"
      },
      unref() {
        unrefCalled = true
      },
    }
  }) as any)

  assert.equal(command, "alis")
  assert.deepEqual(args, ["skills", "sync", "--cache-only"])
  assert.deepEqual(CATALOG_SYNC_ARGS, ["skills", "sync", "--cache-only"])
  assert.deepEqual(options, { detached: true, stdio: "ignore" })
  assert.equal(errorHandlerRegistered, true)
  assert.equal(unrefCalled, true)
})
