import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"

/**
 * Alis Build plugin for opencode.
 *
 * This file ships the two pieces of behaviour that genuinely need code:
 *
 *   1. Injecting the opencode session id into Alis MCP calls (LoadSkill / SpecIt).
 *   2. Injecting a cwd-dependent "service context" block when the session is
 *      opened inside an Alis Build workspace directory — the mirror of the Claude
 *      plugin's `inject-service-context.sh` SessionStart hook.
 *
 * Everything else the Claude Code plugin did is config in opencode (see
 * opencode.example.json and the README):
 *
 *   - the MCP server            -> `mcp.api`        in opencode.json
 *   - the always-loaded primer  -> `instructions`   in opencode.json
 *   - the build-it / fix-it cmds -> `command/*.md`   (or the `command` config key)
 *   - auto-approving `alis ...`  -> `permission.bash` in opencode.json
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
 *
 * ---------------------------------------------------------------------------
 * Session-id injection (mirror of the Claude `inject-skill-session-id` hook)
 * ---------------------------------------------------------------------------
 * The Alis MCP server uses the caller's session id to resolve the active Context
 * and prepend an <alis-runtime-context> block to LoadSkill / SpecIt results. The
 * model never supplies it; we merge it into the outgoing tool arguments here.
 *
 * NOTE: opencode's plugin hook surface is younger and less documented than Claude
 * Code's. The field accessors below (`input.tool`, `output.args`, the chat.message
 * `parts` array, and where the session id is exposed) are written defensively and
 * should be re-verified against the installed @opencode-ai/plugin version — see
 * the README "Verify" section.
 */

// Matches the Alis MCP tools that resolve server-side Context from the session id.
// MCP tools are exposed to opencode with a server-name prefix, so match the suffix.
const SESSION_AWARE_TOOL = /(?:^|[._-])(LoadSkill|SpecIt)$/

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

export const AlisBuildPlugin: Plugin = async ({ directory, worktree }: any) => {
  // The working directory is fixed for the life of the plugin (opencode loads
  // plugins per project), so compute the block once.
  const cwd: string = directory ?? worktree ?? ""
  const serviceContext = cwd ? buildServiceContext(cwd) : null

  // Inject the block into the first user message of each session only.
  const injectedSessions = new Set<string>()
  let injectedWithoutSessionId = false

  return {
    "chat.message": async (_input: any, output: any) => {
      if (!serviceContext) return

      const sessionID: string | undefined =
        output?.message?.sessionID ?? output?.message?.info?.sessionID ?? _input?.sessionID
      if (sessionID) {
        if (injectedSessions.has(sessionID)) return
        injectedSessions.add(sessionID)
      } else {
        if (injectedWithoutSessionId) return
        injectedWithoutSessionId = true
      }

      const parts: any[] | undefined = output?.parts
      if (!Array.isArray(parts)) return

      const block = `<alis-service-context>\n${serviceContext}\n</alis-service-context>`
      const firstText = parts.find((p) => p && p.type === "text" && typeof p.text === "string")
      if (firstText) {
        firstText.text = `${block}\n\n${firstText.text}`
      } else {
        parts.unshift({ type: "text", text: block })
      }
    },

    "tool.execute.before": async (input: any, output: any) => {
      const toolName: string = input?.tool ?? ""
      if (!SESSION_AWARE_TOOL.test(toolName)) return

      // Resolve the current session id. The precise accessor depends on the
      // opencode plugin API version; try the documented shapes in order.
      const sessionID: string | undefined =
        input?.sessionID ?? input?.sessionId ?? output?.sessionID

      if (!sessionID) return

      // Merge session_id into the outgoing MCP arguments without clobbering
      // anything the model already set.
      const args = (output.args ??= {})
      if (args.session_id == null) args.session_id = sessionID
    },
  }
}

export default AlisBuildPlugin
