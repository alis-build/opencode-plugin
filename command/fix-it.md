---
description: Alias for build-it: find the right Alis Build skill to fix or build something.
---

Run the Alis Build "fix it" router (the fix-it alias of "build it") as described in the DBD primer's routing contract: infer what I want fixed or built from the current request, visible errors, and workspace context (ask exactly one concise clarification only if the goal is ambiguous), run `alis skills search "<clarified goal>" --json` (use the MCP SearchSkills tool only if no shell is available), present the matching skills, and load the one I choose with `alis skills load <id>`. If the search returns nothing, say so and offer `alis skills request` — do not fall back to listing the whole catalogue. Do not run Define, Build, Deploy, commits, or code edits from this router step — only the loaded skill does that, and only when its workflow requires it.
