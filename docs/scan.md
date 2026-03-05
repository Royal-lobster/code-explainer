# Step 1: Scout the Codebase

Dispatch a **`SMALL`** sub-agent to discover relevant files and map the call chain. The scout does not generate highlights — it only maps the territory.

Agent tool parameters:
- `subagent_type`: `Explore`
- `model`: `SMALL` ← replace with model from SKILL.md
- `description`: `Scout codebase for {feature}`

## Prompt template

```
Scout this codebase to find all files relevant to "{feature}".

1. Grep for: {feature name}, key class names, key function names
2. Glob for file patterns in relevant directories
3. Read entry points and key files to understand the flow
4. Follow imports to discover related files

Return a structured result:

**Entry point**: the file/function where the feature starts

**Call chain**: what calls what (A → B → C → D)

**Files** (one per relevant file, in call-flow order):
  {file_absolute_path}:{start}-{end} [{complexity}]
  Role: what this file does in the feature
  Receives: what arrives from the previous file (or "entry point")
  Produces: what it hands off to the next file
  Notable: any non-obvious design decisions, patterns, or gotchas

{complexity} is one of:
  - `[core]` — central logic. Needs thorough explanation.
  - `[wiring]` — boilerplate, config, DI. Breeze through.
  - `[supporting]` — helpers, utilities, types. Explain briefly.

Depth level: {overview|deep-dive}
File count targets:
- Overview: 4-8 files
- Deep Dive: 8-15 files

Ordering: entry point first, follow data/call flow, group related logic, end with utilities/types/config.
```

Include the feature name, any files the user mentioned, and the depth level from step 0. If the user pointed to a specific file, tell the sub-agent to start there.
