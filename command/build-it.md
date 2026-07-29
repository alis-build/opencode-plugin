---
description: Find the right Alis Build skill for what you want to build.
---

Run the Alis Build "build it" router as described in the DBD primer's routing contract: infer what I want built from the current request and workspace context (ask exactly one concise clarification only if the goal is ambiguous), run `alis skills search "<clarified goal>" --json`, present the matching skills, and load the one I choose with `alis skills load <id>`. If the search returns nothing, say so and offer `alis skills request` — do not fall back to listing the whole catalogue. Do not run Define, Build, Deploy, commits, or code edits from this router step — only the loaded skill does that, and only when its workflow requires it.
