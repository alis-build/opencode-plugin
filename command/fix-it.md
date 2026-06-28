---
description: Alias for build-it: find the right Alis Build skill to fix or build something.
---

Run the Alis Build "fix it" router (the fix-it alias of "build it") as described in the Alis Build MCP server instructions: infer what I want fixed or built from the current request, visible errors, and workspace context (ask exactly one concise clarification only if the goal is ambiguous), call SearchSkills with the clarified goal, present the matching skills, and load the one I choose. Do not run Define, Build, Deploy, commits, or code edits from this router step — only the loaded skill does that, and only when its workflow requires it.
