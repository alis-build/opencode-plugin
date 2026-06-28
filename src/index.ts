import type { Plugin } from "@opencode-ai/plugin"

/**
 * Alis Build plugin for opencode.
 *
 * This file ships the one piece of behaviour that genuinely needs code: injecting
 * the opencode session id into Alis MCP calls. Everything else the Claude Code
 * plugin did is config in opencode (see opencode.example.json and the README):
 *
 *   - the MCP server            -> `mcp.api`        in opencode.json
 *   - the always-loaded primer  -> `instructions`   in opencode.json
 *   - the build-it / fix-it cmds -> `command/*.md`   (or the `command` config key)
 *   - auto-approving `alis ...`  -> `permission.bash` in opencode.json
 *
 * opencode has no "config" hook, so a plugin cannot register MCP servers,
 * instructions, or commands programmatically — that is why those live in config.
 *
 * ---------------------------------------------------------------------------
 * Session-id injection (mirror of the Claude `inject-skill-session-id` hook)
 * ---------------------------------------------------------------------------
 * The Alis MCP server uses the caller's session id to resolve the active Context
 * and prepend an <alis-runtime-context> block to LoadSkill / SpecIt results. The
 * model never supplies it; we merge it into the outgoing tool arguments here.
 *
 * NOTE: opencode's plugin hook surface is younger and less documented than Claude
 * Code's. The exact field names below (`input.tool`, `output.args`, and where the
 * session id is exposed) MUST be verified against the installed @opencode-ai/plugin
 * version before relying on this in production — see the README "Verify" section.
 */

// Matches the Alis MCP tools that resolve server-side Context from the session id.
// MCP tools are exposed to opencode with a server-name prefix, so match the suffix.
const SESSION_AWARE_TOOL = /(?:^|[._-])(LoadSkill|SpecIt)$/

export const AlisBuildPlugin: Plugin = async ({ client }) => {
  return {
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
