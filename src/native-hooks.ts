import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

type Object = Record<string, any>
type Spawner = typeof spawn
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const maxPayload = 8 << 20
const maxResponse = 64 << 10

export const UPGRADE_NOTICE = "alis: this plugin requires a newer Alis CLI. Run `alis upgrade`, then restart OpenCode to enable all Alis hooks."

/** A bounded JSON pipe to the binary. Hook data is never a shell command. */
export function runJSON(
  args: string[], payload: Object | undefined, cwd: string,
  spawnProcess: Spawner = spawn, timeout = 9000,
): Promise<Object | null> {
  return new Promise((resolve) => {
    let child: ReturnType<Spawner> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let data = ""
    let bytes = 0
    const finish = (value: Object | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const stop = () => {
      try { child?.kill("SIGKILL") } catch { /* already exited */ }
      finish(null)
    }
    try {
      const input = payload === undefined ? "" : JSON.stringify(payload)
      if (Buffer.byteLength(input) > maxPayload) return finish(null)
      child = spawnProcess("alis", args, { cwd: cwd || undefined, stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
      timer = setTimeout(stop, timeout)
      child.on("error", () => finish(null))
      child.stdin!.on("error", stop)
      child.stdout!.setEncoding("utf8")
      child.stdout!.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > maxResponse) return stop()
        data += chunk
      })
      child.on("close", (code) => {
        try {
          const value = JSON.parse(data || "{}")
          finish(code === 0 && value && typeof value === "object" && !Array.isArray(value) ? value : null)
        } catch { finish(null) }
      })
      child.stdin!.end(input)
    } catch { stop() }
  })
}

/** Retain source ownership even when the CLI is absent or cannot start. */
export function hasHandoffClaim(sessionID: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(sessionID) &&
    existsSync(join(homedir(), ".alis", "handoff-sessions", `opencode--${sessionID}.claim`))
}

export function createNativeHooks(cwd: string, spawnProcess: Spawner = spawn) {
  const supported = runJSON(["hooks", "capabilities"], undefined, cwd, spawnProcess, 1500).then((caps) =>
    caps?.protocol === 1 && Array.isArray(caps.harnesses) && caps.harnesses.includes("opencode") &&
    Array.isArray(caps.handlers) && ["permission", "secrets", "handoff", "sync"].every((name) => caps.handlers.includes(name)),
  )
  const run = async (handler: string, payload: Object, timeout = 9000): Promise<Object | null> => {
    if (!await supported) return null
    return runJSON(["hooks", "run", "--protocol", "1", "--harness", "opencode", "--handler", handler, "--plugin-root", pluginRoot], payload, cwd, spawnProcess, timeout)
  }
  const handoff = async (sessionID: string | undefined, event: string, extra: Object = {}): Promise<void> => {
    if (!sessionID || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionID)) return
    const payload = { ...extra, agent: "opencode", integration: 2, session_id: sessionID, cwd, hook_event_name: event }
    const response = await supported
      ? await run("handoff", payload)
      : await runJSON(["workstation", "handoff", "_hook"], payload, cwd, spawnProcess)
    if (["PreToolUse", "UserPromptSubmit"].includes(event) &&
      (response?.continue === false || (!response && hasHandoffClaim(sessionID)))) {
      throw new Error(response?.stopReason ?? "Handoff owns this continuation. Check handoff status before continuing locally.")
    }
  }
  return { supported, run, handoff }
}
