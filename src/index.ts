import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
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
 *   1. Refreshing the local skills catalog at plugin startup with the explicit
 *      legacy-safe `alis skills sync --cache-only` contract. This never installs
 *      or prunes native per-skill entries.
 *   2. Injecting the DBD primer and a cwd-dependent "service context" block into
 *      the first message of each session (mirror of the Claude plugin's
 *      `load-primer.sh` + `inject-service-context.sh` SessionStart hooks). The
 *      primer is workspace-gated like the Claude hook: the full primer
 *      (instructions/dbd-primer.md) only when the session's working directory
 *      sits inside an alis.build workspace; the compressed digest
 *      (instructions/dbd-digest.md) when the `alis` CLI is on PATH but the
 *      directory is not; nothing otherwise — zero tokens for unrelated
 *      projects. ALIS_PRIMER=full|digest|off overrides the gate, and the
 *      CLI-presence probe (a PATH scan) runs lazily and is cached for the
 *      life of the plugin.
 *   3. Auto-approving clean, single `alis …` shell commands via `permission.ask`
 *      (mirror of `allow-alis-cli.sh`), with the same double-key carve-outs:
 *      `--confirm-production`, `--approve`, and `blocks|block uninstall --yes`
 *      always stay on a human prompt.
 *   4. Recording the pending `alis` command at `~/.alis/agent-approval.json` so
 *      the alis CLI's approval gate can treat a plugin-auto-allowed command as a
 *      standing grant (permission_mode "auto-allow"; anything the human clicked
 *      through records "default").
 *   5. Exporting `ALIS_OPENCODE=1` into every shell command via `shell.env` — the
 *      env marker the alis CLI requires before trusting the approval record —
 *      plus `ALIS_SESSION_ID` when the hook input carries a session id.
 *   6. Per-prompt ambient skill discovery via `chat.message` (mirror of the
 *      Claude plugin's `suggest-skills.sh` UserPromptSubmit hook): each user
 *      message is piped as a JSON payload to
 *      `alis skills suggest --hook --harness opencode`, and any plain-text
 *      output is appended to the message as an <alis-skill-hint> block. Inside
 *      an alis.build workspace every prompt goes to the CLI; elsewhere a cheap
 *      prefilter forwards only prompts that could carry a wake phrase
 *      ("alis, …", "capture this as a skill"), so explicit addresses work from
 *      any directory. The CLI owns all real gating — wake-phrase regexes,
 *      per-session caps, and the distinctive-score confidence gate that keeps
 *      ambient one-liners off generic prompts. Every failure path (alis
 *      missing, spawn error, timeout, non-zero exit) is swallowed — discovery
 *      must never break a prompt.
 *
 * The /discover and /capture commands remain config
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

/** Load a markdown file shipped inside this package, or null when unreadable/empty. */
function loadInstruction(name: string): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const text = readFileSync(join(here, "..", "instructions", name), "utf8").trim()
    return text.length ? text : null
  } catch {
    return null
  }
}

export type PrimerMode = "full" | "digest" | "off"

/** Is `dir` inside (or exactly at the root of) an alis.build workspace? */
export function inAlisWorkspace(dir: string): boolean {
  return /\/alis\.build(\/|$)/.test(dir)
}

/**
 * Scan PATH for an `alis` executable. Pure given `env`; the plugin wraps it in
 * a per-load cache so the filesystem is probed at most once per session.
 */
export function findAlisOnPath(env: Record<string, string | undefined> = process.env): boolean {
  const path = env.PATH ?? ""
  if (!path) return false
  const sep = process.platform === "win32" ? ";" : ":"
  const names = process.platform === "win32" ? ["alis.exe", "alis.cmd", "alis.bat", "alis"] : ["alis"]
  for (const dir of path.split(sep)) {
    if (!dir) continue
    for (const name of names) {
      try {
        if (existsSync(join(dir, name))) return true
      } catch {
        // An unreadable PATH entry is just "not found".
      }
    }
  }
  return false
}

/**
 * Resolve which primer variant this session gets (mirror of the Claude
 * plugin's workspace-gated `load-primer.sh`):
 *
 *   full   — the working directory is inside an alis.build workspace (a
 *            session doing DBD work);
 *   digest — outside a workspace but the `alis` CLI is installed, so
 *            wake-word skill routing keeps minimal context;
 *   off    — neither: zero tokens for unrelated projects.
 *
 * ALIS_PRIMER=full|digest|off overrides the gate. `hasCli` is called lazily —
 * only when the answer actually depends on CLI presence.
 */
export function resolvePrimerMode(
  dir: string,
  hasCli: () => boolean,
  env: Record<string, string | undefined> = process.env,
): PrimerMode {
  const override = env.ALIS_PRIMER
  if (override === "off" || override === "full" || override === "digest") return override
  if (inAlisWorkspace(dir)) return "full"
  return hasCli() ? "digest" : "off"
}

/**
 * The text to inject for a primer mode. A missing digest falls back to the
 * full primer (same graceful degradation as the shell hook); a missing primer
 * emits nothing.
 */
export function loadPrimerForMode(
  mode: PrimerMode,
  load: (name: string) => string | null = loadInstruction,
): string | null {
  if (mode === "off") return null
  if (mode === "digest") return load("dbd-digest.md") ?? load("dbd-primer.md")
  return load("dbd-primer.md")
}

/** Hard cap on how long a per-prompt suggest call may delay the message. */
const SUGGEST_TIMEOUT_MS = 1500

/**
 * Should this prompt be forwarded to `alis skills suggest`? Inside an
 * alis.build workspace: always. Elsewhere: only when the prompt could carry a
 * wake phrase ("alis, …", "capture this as a skill") — a loose lexical
 * prefilter; the CLI's strict regexes make the actual decision.
 * ALIS_SUGGEST_ALWAYS=1 disables the prefilter.
 */
export function shouldRunSuggest(cwd: string, prompt: string, env: Record<string, string | undefined> = process.env): boolean {
  if (cwd.includes("/alis.build/")) return true
  if (env.ALIS_SUGGEST_ALWAYS === "1") return true
  return /alis|skill/i.test(prompt)
}

export const CATALOG_SYNC_ARGS = ["skills", "sync", "--cache-only"] as const

type CatalogSyncChild = {
  on: (event: "error", listener: () => void) => unknown
  unref: () => void
}

type CatalogSyncSpawner = (
  command: string,
  args: readonly string[],
  options: { detached: true; stdio: "ignore" },
) => CatalogSyncChild

/**
 * Refresh catalog metadata without delaying plugin startup. The explicit
 * --cache-only flag keeps this safe with older alis CLIs whose default sync
 * installed native skills. Every failure is swallowed by contract.
 */
export function startCatalogSync(spawnProcess: CatalogSyncSpawner = spawn as unknown as CatalogSyncSpawner): void {
  try {
    const child = spawnProcess("alis", CATALOG_SYNC_ARGS, { detached: true, stdio: "ignore" })
    child.on("error", () => {})
    child.unref()
  } catch {
    // Catalog refresh is best-effort and must never break plugin startup.
  }
}

export const AlisBuildPlugin: Plugin = async ({ directory, worktree, $ }: any) => {
  startCatalogSync()

  // The working directory is fixed for the life of the plugin (opencode loads
  // plugins per project), so compute the injected blocks once.
  const cwd: string = directory ?? worktree ?? ""
  const serviceContext = cwd ? buildServiceContext(cwd) : null
  // Workspace-gated primer (see the header comment): full inside an
  // alis.build workspace, digest when only the CLI is present, nothing
  // otherwise; ALIS_PRIMER overrides. The PATH probe is lazy and cached.
  let cliProbe: boolean | undefined
  const hasCli = (): boolean => (cliProbe ??= findAlisOnPath())
  const primer = loadPrimerForMode(resolvePrimerMode(cwd || process.cwd(), hasCli))

  /**
   * Run `alis skills suggest` with the hook payload on stdin and return its
   * trimmed stdout ("" when there is no suggestion). Uses the plugin context's
   * Bun shell (`$`); `.nothrow()` keeps non-zero exits from throwing and
   * `.quiet()` keeps the CLI's stdout out of the terminal. Any failure —
   * including a missing alis binary — resolves to "".
   */
  const runSuggest = async (prompt: string, sessionID: string | undefined): Promise<string> => {
    if (typeof $ !== "function") return ""
    const payload = JSON.stringify({
      session_id: sessionID ?? "",
      prompt,
      cwd,
      permission_mode: "default",
    })
    const stdin = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    })
    const out = await $`alis skills suggest --hook --harness opencode < ${stdin}`.quiet().nothrow()
    if (out.exitCode !== 0) return ""
    return out.text().trim()
  }

  // Inject the blocks into the first user message of each session only.
  const injectedSessions = new Set<string>()
  let injectedWithoutSessionId = false

  // Permission ids / call ids this plugin auto-allowed via permission.ask. Used
  // to distinguish "auto-allow" (standing grant) from "default" (the human saw a
  // prompt, or the allow came from user config) in the approval record.
  const autoAllowed = new Set<string>()

  return {
    "chat.message": async (input: any, output: any) => {
      const parts: any[] | undefined = output?.parts
      if (!Array.isArray(parts)) return

      const sessionID: string | undefined =
        input?.sessionID ?? output?.message?.sessionID ?? output?.message?.info?.sessionID

      // Capture the user's raw prompt text BEFORE any injection mutates the
      // parts — the suggest payload must carry the prompt, not the primer.
      const promptText = parts
        .filter((p) => p && p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n")
        .trim()

      // 1) Primer + service context, first user message of each session only.
      if (primer || serviceContext) {
        let firstMessage: boolean
        if (sessionID) {
          firstMessage = !injectedSessions.has(sessionID)
          if (firstMessage) injectedSessions.add(sessionID)
        } else {
          firstMessage = !injectedWithoutSessionId
          injectedWithoutSessionId = true
        }
        if (firstMessage) {
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
        }
      }

      // 2) Per-prompt ambient skill discovery, every user message with text.
      // Inside a workspace the CLI sees every prompt; elsewhere only prompts
      // that could carry a wake phrase are forwarded. The CLI owns all real
      // gating (wake phrases, dedupe, confidence, latency budget).
      if (!promptText) return
      if (!shouldRunSuggest(cwd, promptText)) return
      try {
        const hint = await Promise.race([
          runSuggest(promptText, sessionID).catch(() => ""),
          new Promise<string>((resolve) => setTimeout(() => resolve(""), SUGGEST_TIMEOUT_MS)),
        ])
        if (!hint) return
        const block = `<alis-skill-hint>\n${hint}\n</alis-skill-hint>`
        const lastText = [...parts]
          .reverse()
          .find((p) => p && p.type === "text" && typeof p.text === "string")
        if (lastText) {
          lastText.text = `${lastText.text}\n\n${block}`
        } else {
          parts.push({ type: "text", text: block })
        }
      } catch {
        // Discovery must never break a prompt.
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

    "shell.env": async (input: any, output: { env: Record<string, string> }) => {
      // The env marker the alis CLI requires before trusting an opencode-written
      // approval record (a stale record from another harness grants nothing).
      output.env.ALIS_OPENCODE = "1"
      // The hook input carries an optional sessionID (plugin d.ts: shell.env
      // input `{ cwd, sessionID?, callID? }`); surface it to the CLI when set.
      const sessionID = input?.sessionID
      if (typeof sessionID === "string" && sessionID) {
        output.env.ALIS_SESSION_ID = sessionID
      }
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
