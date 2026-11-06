import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import { test } from "node:test"
import { AlisBuildPlugin } from "../src/index.ts"
import { createNativeHooks, runJSON } from "../src/native-hooks.ts"

const caps = { protocol: 1, harnesses: ["opencode"], handlers: ["permission", "secrets", "sync", "handoff"] }

function fakeSpawner(reply: (args: string[], payload: any) => { text?: string; code?: number; hang?: boolean }) {
  const calls: { args: string[]; payload: any; options: any }[] = []
  let killed = 0
  const spawnProcess = ((_command: string, args: string[], options: any) => {
    assert.equal(_command, "alis")
    const child: any = new EventEmitter()
    child.stdout = new PassThrough()
    child.kill = () => { killed++; return true }
    let input = ""
    child.stdin = new Writable({
      write(chunk, _encoding, callback) { input += chunk; callback() },
      final(callback) {
        const payload = input ? JSON.parse(input) : undefined
        calls.push({ args, payload, options })
        queueMicrotask(() => {
          const result = reply(args, payload)
          if (result.hang) return
          child.stdout.end(result.text ?? "")
          child.emit("close", result.code ?? 0)
        })
        callback()
      },
    })
    return child
  }) as typeof spawn
  return { spawnProcess, calls, killed: () => killed }
}

test("one capability probe; all native payloads go over stdin without a shell", async () => {
  const fake = fakeSpawner((args) => ({ text: JSON.stringify(args[1] === "capabilities" ? caps : { status: "allow" }) }))
  const native = createNativeHooks("/work space", fake.spawnProcess)
  const command = 'alis whoami; $(touch sentinel)'
  assert.equal(await native.supported, true)
  await native.run("permission", { tool_input: { command } })
  await native.run("sync", { source: "startup" })
  await native.handoff("session-a", "Stop", { related_sessions: ["child"] })
  assert.equal(fake.calls.filter((c) => c.args[1] === "capabilities").length, 1)
  assert.equal(fake.calls[1].payload.tool_input.command, command)
  assert.ok(!fake.calls[1].args.includes(command))
  assert.ok(fake.calls.every((c) => c.options.shell === undefined && c.options.windowsHide === true))
  assert.equal(fake.calls[3].payload.agent, "opencode")
  assert.deepEqual(fake.calls[3].payload.related_sessions, ["child"])
})

test("older CLI keeps legacy handoff and defers permission; no false capability match", async () => {
  for (const capability of [{ protocol: 1, handlers: caps.handlers, harnesses: ["claude"] }, { ...caps, protocol: 2 }, { ...caps, handlers: ["handoff"] }]) {
    const fake = fakeSpawner((args) => ({ text: JSON.stringify(args[1] === "capabilities" ? capability : { continue: false, stopReason: "claimed" }) }))
    const native = createNativeHooks("", fake.spawnProcess)
    assert.equal(await native.supported, false)
    assert.equal(await native.run("permission", {}), null)
    await assert.rejects(native.handoff("session-a", "PreToolUse"), /claimed/)
    assert.deepEqual(fake.calls[1].args, ["workstation", "handoff", "_hook"])
  }
})

test("native handoff denial retains the OpenCode fence", async () => {
  const fake = fakeSpawner((args) => ({ text: JSON.stringify(args[1] === "capabilities" ? caps : { continue: false, stopReason: "claimed" }) }))
  const native = createNativeHooks("", fake.spawnProcess)
  await assert.rejects(native.handoff("session-a", "PreToolUse"), /claimed/)
  await assert.rejects(native.handoff("session-a", "UserPromptSubmit"), /claimed/)
  await native.handoff("session-a", "Stop")
  await native.handoff("../invalid", "PreToolUse")
  assert.equal(fake.calls.length, 4)
})

test("transport bounds hangs and rejects malformed, failed and oversized responses", async () => {
  for (const result of [{ text: "not JSON" }, { text: "[]" }, { text: "null" }, { text: "{}", code: 1 }, { text: " ".repeat(65537) }, { hang: true }]) {
    const fake = fakeSpawner(() => result)
    assert.equal(await runJSON(["hooks", "capabilities"], undefined, "", fake.spawnProcess, 10), null)
    if (result.hang || result.text!.length > 65536) assert.equal(fake.killed(), 1)
  }
  assert.equal(await runJSON([], {}, "", (() => { throw new Error("missing") }) as any), null)
  const fake = fakeSpawner(() => ({}))
  assert.equal(await runJSON([], { input: "x".repeat(8 << 20) }, "", fake.spawnProcess), null)
  assert.equal(fake.calls.length, 0)
})

function isolatedHome(t: any) {
  const home = mkdtempSync(join(tmpdir(), "alis-opencode-"))
  const before = { ...process.env }
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.PATH = home
  process.env.ALIS_PRIMER = "off"
  for (const key of ["ALIS_BUILD_SHELL", "ALIS_BUILD_WORKSTATION", "GOOGLE_CLOUD_WORKSTATIONS", "REFRESH_TOKEN_PATH", "ALIS_HANDOFF_ID"]) delete process.env[key]
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
    Object.assign(process.env, before)
    rmSync(home, { recursive: true, force: true })
  })
  return home
}

test("missing CLI remains quiet except source claims still fence tool and prompt hooks", async (t) => {
  const home = isolatedHome(t)
  mkdirSync(join(home, ".alis", "handoff-sessions"), { recursive: true })
  writeFileSync(join(home, ".alis", "handoff-sessions", "opencode--session-a.claim"), "{}")
  let aborted = 0
  const hooks = await AlisBuildPlugin({ directory: home, client: { session: { abort: async () => { aborted++ } } } } as any)
  const permission = { status: "ask" as const }
  await hooks["permission.ask"]!({ type: "bash", title: "alis whoami" } as any, permission)
  assert.equal(permission.status, "ask")
  await assert.rejects(hooks["tool.execute.before"]!({ sessionID: "session-a", tool: "bash" } as any, { args: {} }), /Handoff owns/)
  assert.equal(aborted, 1)
  await assert.rejects(hooks["chat.message"]!({ sessionID: "session-a" } as any, { parts: [] } as any), /Handoff owns/)
  const output = { parts: [{ type: "text", text: "hello" }] }
  await hooks["chat.message"]!({ sessionID: "unclaimed" } as any, output as any)
  assert.deepEqual(output.parts, [{ type: "text", text: "hello" }])
})

test("plugin callbacks use the real Go binary with no Python, shell or jq on PATH", { skip: !process.env.ALIS_TEST_CLI || process.platform === "win32" }, async (t) => {
  const binary = process.env.ALIS_TEST_CLI!
  const home = isolatedHome(t)
  symlinkSync(binary, join(home, "alis"))
  const hooks = await AlisBuildPlugin({ directory: home, client: {} } as any)
  for (const [command, expected] of [["alis whoami --json", "allow"], ["alis whoami; touch sentinel", "ask"], ["alis deploy example.app.api.v1 --confirm-production", "ask"]]) {
    const output: any = { status: "ask" }
    await hooks["permission.ask"]!({ type: "bash", metadata: { command } } as any, output)
    assert.equal(output.status, expected)
  }
  const denied: any = { status: "deny" }
  await hooks["permission.ask"]!({ type: "bash", title: "alis whoami" } as any, denied)
  assert.equal(denied.status, "deny")
  const value = "ghp_" + "x".repeat(36)
  const output: any = { output: value }
  await hooks["tool.execute.after"]!({ sessionID: "session-a", tool: "bash", args: {} } as any, output)
  const added = output.output.slice(value.length)
  assert.ok(added.includes("github"))
  assert.ok(!added.includes(value))
  const repeat: any = { output: value }
  await hooks["tool.execute.after"]!({ sessionID: "session-a", tool: "bash", args: {} } as any, repeat)
  assert.equal(repeat.output, value)
  assert.equal(existsSync(join(home, ".alis", "agent-approval.json")), false)
  const health = JSON.parse(readFileSync(join(home, ".alis", "opencode-plugin-health.json"), "utf8"))
  assert.equal(health.version, "0.18.0")
  assert.equal(health.hookProtocol, 1)
})

test("released older CLI shows one upgrade notice and defers optional hooks", { skip: !process.env.ALIS_TEST_OLD_CLI || process.platform === "win32" }, async (t) => {
  const binary = process.env.ALIS_TEST_OLD_CLI!
  const home = isolatedHome(t)
  symlinkSync(binary, join(home, "alis"))
  const hooks = await AlisBuildPlugin({ directory: home, client: {} } as any)
  const permission: any = { status: "ask" }
  await hooks["permission.ask"]!({ type: "bash", title: "alis whoami" } as any, permission)
  assert.equal(permission.status, "ask")
  for (let i = 0; i < 2; i++) {
    const output: any = { parts: [{ type: "text", text: "hello" }] }
    await hooks["chat.message"]!({ sessionID: "session-a" } as any, output)
    assert.equal(JSON.stringify(output).includes("alis upgrade"), i === 0)
  }
  const output: any = { output: "plain text" }
  await hooks["tool.execute.after"]!({ tool: "bash", args: {} } as any, output)
  assert.equal(output.output, "plain text")
  assert.equal(existsSync(join(home, ".alis", "agent-approval.json")), false)
})
