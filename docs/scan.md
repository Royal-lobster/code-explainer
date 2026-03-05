# Step 2: Scan the Codebase

Dispatch a haiku sub-agent to scan. This saves main context for the walkthrough.

Agent tool parameters:
- `subagent_type`: `Explore`
- `model`: `haiku`
- `description`: `Scan codebase for {feature}`

## Prompt template

```
Scan this codebase to find all files relevant to "{feature}".

1. Grep for: {feature name}, key class names, key function names
2. Glob for file patterns in relevant directories
3. Read entry points and key files to understand the flow
4. Follow imports to discover related files

Return a structured result:
- **Entry point**: the file/function where the feature starts
- **Core files**: list of files with brief description of each
- **Call chain**: what calls what (A -> B -> C)
- **Walkthrough plan**: ordered list of segments, each as:
  {file_absolute_path}:{start}-{end} -- {title} [{complexity}]
    Sub-highlights (2-5 per segment):
      - {start}-{end} -- {ttsText: 1-2 sentence plain-text narration} [explanation: optional markdown explanation]

  IMPORTANT — field names must match the sidebar API exactly:
  - `start` / `end` (not startLine / endLine)
  - `title` (not label or description)
  - `highlights`: required array of sub-ranges (minimum 1), each with `start`, `end`, `ttsText`

  {complexity} is one of:
  - `[core]` — central logic. Explain thoroughly.
  - `[wiring]` — boilerplate, config, DI. Breeze through.
  - `[supporting]` — helpers, utilities, types. Explain briefly.

  Sub-highlights: focused 5-15 line blocks at logical boundaries
  (imports, function signatures, conditionals, return values, setup vs logic).

Depth level: {overview|detailed|focused}
Segment sizing:
- Overview: 40-80 lines per segment, 4-8 segments total
- Detailed: 15-40 lines per segment, 8-15 segments total
- Focused: 1-3 segments, only what's relevant

Ordering: entry point first, follow data/call flow, group related logic, end with utilities/types/config.
```

Include the feature name, any files the user mentioned, and the depth level from step 1. If the user pointed to a specific file, tell the sub-agent to start there.
