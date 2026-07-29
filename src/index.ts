import type { Plugin } from "@opencode-ai/plugin"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Alis Build plugin for opencode.
 *
 * This file ships the behaviour that needs code — the opencode mirror of the
 * Claude Code plugin's hooks:
 *
 *   1. Injecting the DBD primer and a cwd-dependent "service context" block into
 *      the first message of each session (mirror of the Claude plugin's
 *      `load-primer.sh` + `inject-service-context.sh` SessionStart hooks).
 *   2. Auto-approving clean, single `alis …` shell commands via `permission.ask`
 *      (mirror of `allow-alis-cli.sh`), with the same double-key carve-outs:
 *      `--confirm-production`, `--approve`, and `blocks|block uninstall --yes`
 *      always stay on a human prompt.
 *   3. Recording the pending `alis` command at `~/.alis/agent-approval.json` so
 *      the alis CLI's approval gate can treat a plugin-auto-allowed command as a
 *      standing grant (permission_mode "auto-allow"; anything the human clicked
 *      through records "default").
 *   4. Exporting `ALIS_OPENCODE=1` into every shell command via `shell.env` — the
 *      env marker the alis CLI requires before trusting the approval record.
 *
 * The build-it / fix-it commands remain config
 * (see opencode.example.json and the README).
 *
 * ---------------------------------------------------------------------------
 * Service-context injection (mirror of `inject-service-context.sh`)
 * ---------------------------------------------------------------------------
 * The Alis Build workspace keeps two parallel trees per organisation:
 *
 *   build  = <root>/alis.build/<org>/build/<path...>          (implementation)
 *   define = <root>/alis.build/<org>/define/<org>/<path...>   (protobuf contract)
 *
 * When the session's working directory sits in one, we inject a pointer to the
 * other half plus the package id (`<org>.<path-with-/-as-.>`, e.g. alis.os.cli.v1)
 * into the first user message of each session. opencode exposes the working
 * directory to the plugin as `directory`; the block is computed once at load.
 */

/**
 * Given a working directory, return the Alis Build service-context block to
 * inject, or null when the directory is not inside an `.../alis.build/<org>/...`
 * build or define tree. Pure except for reading the filesystem (to confirm the
 * counterpart directory exists and to list `.proto` files).
 */
export function buildServiceContext(dir: string): string | null {
  const marker = "/alis.build/"
  const idx = dir.indexOf(marker)
  if (idx === -1) return null

  const root = dir.slice(0, idx) + "/alis.build"
  const rest = dir.slice(idx + marker.length)
  const parts = rest.split("/").filter(Boolean)
  const org = parts[0]
  const side = parts[1]
  if (!org || !side) return null

  let segs: string[]
  if (side === "build") {
    segs = parts.slice(2)
  } else if (side === "define") {
    // define nests an inner <org>; anything else (vendored google/lf symlinks) is
    // not this org's own service.
    if (parts[2] !== org) return null
    segs = parts.slice(3)
  } else {
    return null
  }

  // Resolve up to the service version (vN) root, so impl subdirs (bff, infra, …)
  // still map to the service.
  const svc: string[] = []
  let foundVersion = false
  for (const s of segs) {
    svc.push(s)
    if (/^v\d+$/.test(s)) {
      foundVersion = true
      break
    }
  }
  if (svc.length === 0) return null

  const relpath = svc.join("/")
  const defineDir = `${root}/${org}/define/${org}/${relpath}`
  const buildDir = `${root}/${org}/build/${relpath}`
  const pkg = foundVersion ? `${org}.${svc.join(".")}` : ""

  const protoLine = (d: string): string => {
    try {
      const names = readdirSync(d)
        .filter((f) => f.endsWith(".proto"))
        .sort()
      return names.length ? `\n  Proto files: ${names.join(", ")}` : ""
    } catch {
      return ""
    }
  }

  const lines: string[] = []
  if (side === "build") {
    lines.push("This opencode session is inside an Alis Build service implementation (build) directory.")
    if (pkg) lines.push(`  Package id:  ${pkg}`)
    if (existsSync(defineDir)) {
      lines.push('  The protobuf definitions (the API contract — the DBD "Define" step) are available here:')
      lines.push(`    ${defineDir}${protoLine(defineDir)}`)
    } else {
      lines.push(`  Expected definitions at ${defineDir} (not found on disk).`)
    }
  } else {
    lines.push("This opencode session is inside an Alis Build definitions (define) directory — the protobuf API contract.")
    if (pkg) lines.push(`  Package id:  ${pkg}`)
    const protos = protoLine(dir)
    if (protos) lines.push(protos.slice(1)) // drop the leading newline
    if (existsSync(buildDir)) {
      lines.push('  The implementation (the DBD "Build" step) is available here:')
      lines.push(`    ${buildDir}`)
    } else {
      lines.push("  This contract has no corresponding build/ implementation directory yet.")
    }
  }
  return lines.join("\n")
}

/**
 * Classify a shell command for the alis auto-approval flow (mirror of
 * `allow-alis-cli.sh`):
 *
 *   "allow" — a clean, single `alis <subcommand> …` invocation.
 *   "defer" — anything else: not alis, chained/redirected (which would let
 *             `alis define && rm -rf /` ride on the allow), an
 *             explicit-approval flag (`--confirm-production`, `--approve`),
 *             `blocks|block uninstall --yes` (destructive, prompt-skipping),
 *             or a subcommand outside ALIS_ALLOWED_SUBCMDS when that
 *             space-separated allowlist is set. Deferred commands stay on
 *             opencode's normal permission prompt — deliberate double-keying
 *             for the carve-outs.
 */
export function classifyAlisCommand(cmd: string): "allow" | "defer" {
  if (!cmd) return "defer"
  // Reject anything that splits into multiple shell segments or redirects. A
  // legitimately-quoted metacharacter just means the user gets a normal prompt
  // this once, which is safe degradation.
  if (/[|&;<>`\n]|\$\(/.test(cmd)) return "defer"

  const tokens = cmd.trim().split(/\s+/)
  if (tokens[0] !== "alis") return "defer"
  const sub = tokens[1] ?? ""

  if (cmd.includes("--confirm-production") || cmd.includes("--approve")) return "defer"
  if ((sub === "blocks" || sub === "block") && tokens.includes("uninstall") && tokens.includes("--yes")) return "defer"

  const allowlist = (process.env.ALIS_ALLOWED_SUBCMDS ?? "").trim()
  if (allowlist && !allowlist.split(/\s+/).includes(sub)) return "defer"

  return "allow"
}

/**
 * Record the pending `alis` command for the alis CLI's approval gate. Mirrors
 * the Claude hook's atomic write: temp file in ~/.alis, chmod 600, rename.
 * Best-effort — any failure is swallowed so it never affects the tool call.
 */
function writeAgentApproval(command: string, sessionID: string | undefined, autoAllowed: boolean): void {
  const dir = join(homedir(), ".alis")
  const tmp = join(dir, `.agent-approval.${process.pid}.${Date.now()}`)
  try {
    mkdirSync(dir, { recursive: true })
    const record = {
      version: 1,
      harness: "opencode",
      permission_mode: autoAllowed ? "auto-allow" : "default",
      session_id: sessionID ?? "",
      command,
      written_at: new Date().toISOString(),
    }
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, join(dir, "agent-approval.json"))
  } catch {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // best-effort cleanup only
    }
  }
}

/** Load the DBD primer shipped inside this package, or null when unreadable. */
function loadPrimer(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const text = readFileSync(join(here, "..", "instructions", "dbd-primer.md"), "utf8").trim()
    return text.length ? text : null
  } catch {
    return null
  }
}

export const AlisBuildPlugin: Plugin = async ({ directory, worktree }: any) => {
  // The working directory is fixed for the life of the plugin (opencode loads
  // plugins per project), so compute the injected blocks once.
  const cwd: string = directory ?? worktree ?? ""
  const serviceContext = cwd ? buildServiceContext(cwd) : null
  const primer = loadPrimer()

  // Inject the blocks into the first user message of each session only.
  const injectedSessions = new Set<string>()
  let injectedWithoutSessionId = false

  // Permission ids / call ids this plugin auto-allowed via permission.ask. Used
  // to distinguish "auto-allow" (standing grant) from "default" (the human saw a
  // prompt, or the allow came from user config) in the approval record.
  const autoAllowed = new Set<string>()

  return {
    "chat.message": async (input: any, output: any) => {
      if (!primer && !serviceContext) return

      const sessionID: string | undefined =
        input?.sessionID ?? output?.message?.sessionID ?? output?.message?.info?.sessionID
      if (sessionID) {
        if (injectedSessions.has(sessionID)) return
        injectedSessions.add(sessionID)
      } else {
        if (injectedWithoutSessionId) return
        injectedWithoutSessionId = true
      }

      const parts: any[] | undefined = output?.parts
      if (!Array.isArray(parts)) return

      const blocks: string[] = []
      if (primer) blocks.push(`<alis-build-primer>\n${primer}\n</alis-build-primer>`)
      if (serviceContext) blocks.push(`<alis-service-context>\n${serviceContext}\n</alis-service-context>`)
      const block = blocks.join("\n\n")

      const firstText = parts.find((p) => p && p.type === "text" && typeof p.text === "string")
      if (firstText) {
        firstText.text = `${block}\n\n${firstText.text}`
      } else {
        parts.unshift({ type: "text", text: block })
      }
    },

    "permission.ask": async (input: any, output: { status: "ask" | "deny" | "allow" }) => {
      if (input?.type !== "bash") return
      const cmd = String(input?.metadata?.command ?? input?.title ?? "")
      if (classifyAlisCommand(cmd) !== "allow") return
      output.status = "allow"
      for (const id of [input?.callID, input?.id]) {
        if (typeof id === "string" && id) autoAllowed.add(id)
      }
    },

    "shell.env": async (_input: any, output: { env: Record<string, string> }) => {
      // The env marker the alis CLI requires before trusting an opencode-written
      // approval record (a stale record from another harness grants nothing).
      output.env.ALIS_OPENCODE = "1"
    },

    "tool.execute.before": async (input: any, output: any) => {
      if (input?.tool !== "bash") return
      const cmd = String(output?.args?.command ?? "")
      // Same conservative gate as the classifier: only a clean, single command
      // whose first token is `alis` is worth recording.
      if (cmd && !/[|&;<>`\n]|\$\(/.test(cmd) && cmd.trim().split(/\s+/)[0] === "alis") {
        writeAgentApproval(cmd, input?.sessionID, autoAllowed.has(input?.callID ?? ""))
      }
    },
  }
}

export default AlisBuildPlugin
